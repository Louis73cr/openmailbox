use std::borrow::Cow;
use std::ops::Range;

use base64::Engine;
use base64::alphabet;
use base64::engine::general_purpose::STANDARD;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use mail_parser::{Charset, Message, MessageParser, MessagePart};

const LENIENT_BASE64: GeneralPurpose = GeneralPurpose::new(
    &alphabet::STANDARD,
    GeneralPurposeConfig::new()
        .with_decode_padding_mode(DecodePaddingMode::Indifferent)
        .with_decode_allow_trailing_bits(true),
);

const ALIASES: &[(&str, &str)] = &[
    ("cp932", "windows-31j"),
    ("x-ms-cp932", "windows-31j"),
    ("shift_jisx0213", "shift_jis"),
    ("eucjp", "euc-jp"),
    ("euc-jisx0213", "euc-jp"),
    ("iso-2022-jp-1", "iso-2022-jp"),
    ("iso-2022-jp-2", "iso-2022-jp"),
    ("iso-2022-jp-3", "iso-2022-jp"),
    ("csiso2022jp2", "iso-2022-jp"),
    ("euc-cn", "gb2312"),
    ("x-euc-cn", "gb2312"),
    ("cp950", "big5"),
    ("windows-950", "big5"),
    ("big5hkscs", "big5-hkscs"),
    ("euckr", "euc-kr"),
    ("ks_c_5601", "euc-kr"),
    ("cp874", "windows-874"),
    ("tis620", "tis-620"),
    ("koi8r", "koi8-r"),
    ("unicode-1-1-utf-7", "utf-7"),
    ("x-unicode20utf7", "utf-7"),
];

const FALLBACK_LABEL: &str = "windows-1252";

fn canonical(label: &str) -> &str {
    let label = label.trim().trim_matches('"');
    ALIASES
        .iter()
        .find(|(alias, _)| alias.eq_ignore_ascii_case(label))
        .map_or(label, |(_, canonical)| canonical)
}

fn charset(label: &str) -> Option<Charset> {
    Charset::from_label(canonical(label).as_bytes())
}

pub(crate) fn parse(raw: &[u8]) -> Option<Message<'_>> {
    let message = MessageParser::default().parse(raw)?;
    match repaired(&message) {
        Some(raw) => MessageParser::default().parse_owned(raw),
        None => Some(message),
    }
}

fn repaired(message: &Message) -> Option<Vec<u8>> {
    let raw = message.raw();
    let mut fixed = Vec::new();
    let mut copied = 0;
    for part in message.root().parts() {
        let block = part.offset_header() as usize..part.offset_body() as usize;
        let Some(headers) = raw.get(block.clone()).filter(|_| block.start >= copied) else {
            continue;
        };
        let Some(headers) = repaired_headers(headers, &part, message) else {
            continue;
        };
        fixed.extend_from_slice(&raw[copied..block.start]);
        fixed.extend_from_slice(headers.as_bytes());
        copied = block.end;
    }
    (copied > 0).then(|| {
        fixed.extend_from_slice(&raw[copied..]);
        fixed
    })
}

fn fallback_label<'m>(message: &'m Message) -> &'m str {
    message
        .root()
        .parts()
        .filter_map(|part| part.content_type()?.attribute("charset"))
        .find(|label| {
            charset(label).is_some_and(|charset| {
                !matches!(
                    charset,
                    Charset::Utf8
                        | Charset::Utf7
                        | Charset::Utf16
                        | Charset::Utf16Le
                        | Charset::Utf16Be
                        | Charset::Replacement
                        | Charset::XUserDefined
                )
            })
        })
        .map_or(FALLBACK_LABEL, canonical)
}

fn repaired_headers(headers: &[u8], part: &MessagePart, message: &Message) -> Option<String> {
    let text = match std::str::from_utf8(headers) {
        Ok(text) if !text.contains('\u{1b}') => Cow::Borrowed(text),
        Ok(_) => Charset::Iso2022Jp.decode(headers),
        Err(_) => match charset(fallback_label(message)) {
            Some(Charset::Iso2022Jp) => Charset::ShiftJis.decode(headers),
            other => other.unwrap_or(Charset::Windows1252).decode(headers),
        },
    };
    let text = utf8_words(&text);
    let text = known_labels(&text);
    let text = match body_charset(part, message) {
        Some(label) => Cow::Owned(with_charset(&text, &label)),
        None => text,
    };
    (text.as_bytes() != headers).then(|| text.into_owned())
}

struct Word {
    range: Range<usize>,
    charset: Charset,
    bytes: Vec<u8>,
}

fn words_to_rewrite(text: &str) -> Vec<Word> {
    let mut words = Vec::new();
    let mut from = 0;
    while let Some(at) = text[from..].find("=?").map(|at| from + at) {
        from = at + 2;
        let rest = &text[from..];
        let Some((label, rest)) = rest.split_once('?') else {
            break;
        };
        let Some((encoding, rest)) = rest.split_once('?') else {
            break;
        };
        let Some(end) = rest.find("?=") else { break };
        let payload = &rest[..end];
        let label = label.split('*').next().unwrap_or_default();
        if label.is_empty()
            || label.contains(char::is_whitespace)
            || payload.contains(char::is_whitespace)
        {
            continue;
        }
        let known = Charset::from_label(label.as_bytes());
        if known.is_some_and(|charset| charset != Charset::Iso2022Jp) {
            continue;
        }
        let Some(charset) = known.or_else(|| charset(label)) else {
            continue;
        };
        let bytes = match encoding {
            "B" | "b" => LENIENT_BASE64.decode(payload).unwrap_or_default(),
            "Q" | "q" => q_decode(payload),
            _ => continue,
        };
        let range = at..text.len() - rest.len() + end + 2;
        from = range.end;
        words.push(Word {
            range,
            charset,
            bytes,
        });
    }
    words
}

fn utf8_words(text: &str) -> Cow<'_, str> {
    let words = words_to_rewrite(text);
    if words.is_empty() {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    let mut index = 0;
    while index < words.len() {
        let start = words[index].range.start;
        let charset = words[index].charset;
        let mut bytes = words[index].bytes.clone();
        let mut end = words[index].range.end;
        while let Some(next) = words
            .get(index + 1)
            .filter(|next| next.charset == charset && text[end..next.range.start].trim().is_empty())
        {
            bytes.extend_from_slice(&next.bytes);
            end = next.range.end;
            index += 1;
        }
        if charset == Charset::Iso2022Jp {
            bytes = without_redundant_escapes(&bytes);
        }
        out.push_str(&text[copied..start]);
        out.push_str("=?UTF-8?B?");
        out.push_str(&STANDARD.encode(charset.decode(&bytes).as_bytes()));
        out.push_str("?=");
        copied = end;
        index += 1;
    }
    out.push_str(&text[copied..]);
    Cow::Owned(out)
}

fn q_decode(payload: &str) -> Vec<u8> {
    let bytes = payload.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let escaped = (bytes[index] == b'=')
            .then(|| bytes.get(index + 1..index + 3))
            .flatten()
            .and_then(|hex| u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok());
        match (escaped, bytes[index]) {
            (Some(byte), _) => {
                out.push(byte);
                index += 3;
            }
            (None, b'_') => {
                out.push(b' ');
                index += 1;
            }
            (None, byte) => {
                out.push(byte);
                index += 1;
            }
        }
    }
    out
}

fn without_redundant_escapes(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == 0x1b && bytes.get(index + 3) == Some(&0x1b) {
            index += 3;
            continue;
        }
        out.push(bytes[index]);
        index += 1;
    }
    out
}

fn known_labels(text: &str) -> Cow<'_, str> {
    let mut out = String::new();
    let mut copied = 0;
    let bytes = text.as_bytes();
    let found = (7..bytes.len())
        .filter(|at| bytes[*at] == b'=' && bytes[at - 7..*at].eq_ignore_ascii_case(b"charset"));
    for at in found {
        let start = at + 1;
        let value = text[start..].trim_start_matches('"');
        let start = text.len() - value.len();
        let end = start
            + value
                .find(['"', ';', ' ', '\t', '\r', '\n'])
                .unwrap_or(value.len());
        let label = &text[start..end];
        if Charset::from_label(label.as_bytes()).is_some() || charset(label).is_none() {
            continue;
        }
        out.push_str(&text[copied..start]);
        out.push_str(canonical(label));
        copied = end;
    }
    if copied == 0 {
        return Cow::Borrowed(text);
    }
    out.push_str(&text[copied..]);
    Cow::Owned(out)
}

fn body_charset(part: &MessagePart, message: &Message) -> Option<String> {
    let declared = part
        .content_type()
        .is_some_and(|content_type| content_type.attribute("charset").is_some());
    if declared || !part.is_text() {
        return None;
    }
    let body = part.decoded();
    if let Err(error) = std::str::from_utf8(&body)
        && error.error_len().is_some()
    {
        let meta = part
            .is_content_type("text", "html")
            .then(|| meta_charset(&body));
        return Some(meta.flatten().unwrap_or(fallback_label(message)).to_owned());
    }
    None
}

fn meta_charset(html: &[u8]) -> Option<&str> {
    let head = &html[..html.len().min(1024)];
    let at = head
        .windows(8)
        .position(|window| window.eq_ignore_ascii_case(b"charset="))?;
    let value = &head[at + 8..];
    let value = value
        .strip_prefix(b"\"")
        .or_else(|| value.strip_prefix(b"'"))
        .unwrap_or(value);
    let end = value
        .iter()
        .position(|byte| !(byte.is_ascii_alphanumeric() || b"-_:.".contains(byte)))
        .unwrap_or(value.len());
    std::str::from_utf8(&value[..end])
        .ok()
        .filter(|label| charset(label).is_some())
}

fn with_charset(headers: &str, label: &str) -> String {
    let mut end = None;
    let mut offset = 0;
    for line in headers.split_inclusive('\n') {
        let continues = line.starts_with([' ', '\t']);
        match end {
            Some(_) if !continues => break,
            Some(_) => end = Some(offset + line.trim_end_matches(['\r', '\n']).len()),
            None if line
                .get(..13)
                .is_some_and(|name| name.eq_ignore_ascii_case("content-type:")) =>
            {
                end = Some(offset + line.trim_end_matches(['\r', '\n']).len());
            }
            None => {}
        }
        offset += line.len();
    }
    match end {
        Some(end) => format!("{}; charset={label}{}", &headers[..end], &headers[end..]),
        None => format!("Content-Type: text/plain; charset={label}\r\n{headers}"),
    }
}

#[cfg(test)]
mod tests {
    use crate::{parse_summary, render};

    #[test]
    fn aliases_and_split_iso_2022_jp_words_decode() {
        let header = b"From: =?iso-2022-jp-2?B?GyRCOzNFRBsoQg==?= <y@example.jp>\r\n\
Subject: =?ISO-2022-JP?B?GyRCRnxLXBsoQg==?=\r\n =?ISO-2022-JP?B?GyRCOGwbKEI=?=\r\n\
Content-Type: text/plain; charset=cp932\r\nContent-Transfer-Encoding: 8bit\r\n\r\n";
        let headers = parse_summary(
            header,
            b"\x90\xbf\x8b\x81\x8f\x91\x82\xcc\x82\xb2\x88\xc4\x93\xe0",
        );
        assert_eq!(headers.from[0].name.as_deref(), Some("山田"));
        assert_eq!(headers.subject.as_deref(), Some("日本語"));
        assert_eq!(headers.preview.as_deref(), Some("請求書のご案内"));
    }

    #[test]
    fn raw_header_text_follows_the_declared_charset() {
        let koi8 = b"Subject: \xf0\xd2\xc9\xd7\xc5\xd4\r\nContent-Type: text/plain; charset=koi8-r\r\n\r\n";
        assert_eq!(parse_summary(koi8, b"").subject.as_deref(), Some("Привет"));
        assert_eq!(
            parse_summary(b"Subject: Caf\xe9\r\n\r\n", b"")
                .subject
                .as_deref(),
            Some("Café")
        );
        let jis = b"Subject: \x1b$BF|K\\8l\x1b(B\r\n\r\n";
        assert_eq!(parse_summary(jis, b"").subject.as_deref(), Some("日本語"));

        let raw = b"Content-Type: multipart/mixed; boundary=\"b\"\r\n\r\n--b\r\n\
Content-Type: text/plain; charset=ISO-2022-JP\r\n\r\nhi\r\n--b\r\n\
Content-Type: application/pdf\r\nContent-Disposition: attachment; filename=\"\x8e\x91\x97\xbf.pdf\"\r\n\
Content-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n--b--\r\n";
        assert_eq!(render(raw).unwrap().attachments[0].filename, "資料.pdf");
    }

    #[test]
    fn text_without_a_charset_is_read_from_its_meta_or_as_windows_1252() {
        let html = b"Content-Type: text/html\r\n\r\n";
        let body = b"<html><head><meta http-equiv=\"Content-Type\" content=\"text/html; charset=Shift_JIS\"></head><body>\x82\xa8\x92m\x82\xe7\x82\xb9</body></html>";
        assert_eq!(
            parse_summary(html, body).preview.as_deref(),
            Some("お知らせ")
        );
        let plain = b"Content-Type: text/plain\r\n\r\n";
        assert_eq!(
            parse_summary(plain, b"caf\xe9\r\n").preview.as_deref(),
            Some("café")
        );
        assert_eq!(
            parse_summary(plain, b"caf\xc3\xa9 cr\xc3")
                .preview
                .as_deref(),
            Some("café cr")
        );
    }
}
