import { buildMessage } from './mime.mjs';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const alice = { name: 'Alice Durand', email: 'alice@example.com' };
const bob = { name: 'Bob Martin', email: 'bob@example.com' };

const people = {
  claire: { name: 'Claire Dubois', email: 'claire.dubois@lumen.example' },
  thomas: { name: 'Thomas Girard', email: 'thomas.girard@lumen.example' },
  sophie: { name: 'Sophie Bernard', email: 'sophie@atelier-bernard.example' },
  hugo: { name: 'Hugo Lefèvre', email: 'hugo.lefevre@studio-nord.example' },
  ines: { name: 'Inès Moreau', email: 'ines.moreau@cabinet-moreau.example' },
  daniel: { name: 'Daniel Weber', email: 'd.weber@kraftwerk.example' },
  laura: { name: 'Laura García', email: 'laura.garcia@sol.example' },
  marco: { name: 'Marco Rossi', email: 'marco.rossi@ponte.example' },
  nadia: { name: 'Nadia Benali', email: 'nadia.benali@mail.example' },
  julien: { name: 'Julien Roux', email: 'julien.roux@mail.example' },
};

const services = {
  hosting: { name: 'CloudHost', email: 'noreply@cloudhost.example' },
  billing: { name: 'CloudHost Billing', email: 'billing@cloudhost.example' },
  parcel: { name: 'Parcel Express', email: 'tracking@parcel.example' },
  newsletter: { name: 'The Tech Wire', email: 'newsletter@techwire.example' },
  calendar: { name: 'Calendar', email: 'calendar@lumen.example' },
  bank: { name: 'Example Bank', email: 'alerts@bank.example' },
  spam: { name: 'Customer Service', email: 'winner@promo-deals.example' },
  shop: { name: 'Lumière Lighting', email: 'offers@news.lumiere.example' },
  orders: { name: 'Lumière Lighting', email: 'orders@lumiere.example' },
  forum: { name: 'Rust Users Forum', email: 'notifications@forum.example' },
  login: { name: 'Lumen Account', email: 'noreply@account.example' },
};

// What lists and marketing platforms add, which the app sorts the inbox by.
function listHeaders(domain) {
  return [`List-Unsubscribe: <https://${domain}/unsubscribe>`, 'List-Unsubscribe-Post: List-Unsubscribe=One-Click'];
}

const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGNgGAWjYBSMglEwCkbBKBgFgwEAA/AAAZ8C5KcAAAAASUVORK5CYII=',
  'base64',
);

function pdf(title) {
  return Buffer.from(`%PDF-1.4\n1 0 obj << /Title (${title}) >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
}

function createRandom(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function signature(person) {
  return `\n\n${person.name}`;
}

function newsletterHtml(issue) {
  return `<!doctype html><html><body style="margin:0;background:#f2f4f7;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="640" align="center" cellpadding="0" cellspacing="0" style="background:#ffffff">
<tr><td style="padding:24px 32px;border-bottom:1px solid #e4e7ec"><img src="cid:logo@techwire.example" width="16" height="16" alt="">
<span style="font-size:13px;color:#667085;margin-left:8px">The Tech Wire · #${issue}</span></td></tr>
<tr><td style="padding:32px"><h1 style="margin:0 0 12px;font-size:24px;color:#101828">What mattered this week</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#344054">Three stories led the week: a new Rust release,
the debate on digital sobriety and the rise of open source mail clients.</p>
<img src="https://images.techwire.example/cover-${issue}.jpg" width="576" height="240" alt="Illustration" style="display:block;width:100%;height:auto">
<p style="margin:16px 0 0"><a href="https://www.techwire.example/issue/${issue}" style="color:#1d4ed8">Read the full issue</a></p></td></tr>
<tr><td style="padding:16px 32px;font-size:12px;color:#98a2b3">You receive this email because you subscribed to The Tech Wire.
<a href="https://www.techwire.example/unsubscribe" style="color:#98a2b3">Unsubscribe</a>
<img src="https://track.techwire.example/open/${issue}.gif" width="1" height="1" alt=""></td></tr></table></body></html>`;
}

const conversations = [
  {
    key: 'atlas',
    subject: 'Project Atlas kickoff',
    messages: [
      { from: 'claire', cc: ['thomas'], text: 'Hi Alice,\n\nWe kick off Project Atlas on Monday. I suggest a scoping meeting at 10am in the Rivoli room.\nCould you prepare a first breakdown of the work packages?\n\nThanks,' },
      { from: 'alice', to: ['claire'], cc: ['thomas'], text: 'Hi Claire,\n\nMonday 10am works for me. I\'ll bring a proposal split into three work packages.' },
      { from: 'thomas', to: ['alice', 'claire'], text: 'Perfect, I\'ll book the room and invite the product team.' },
      { from: 'claire', to: ['alice'], cc: ['thomas'], text: 'Thanks to you both. The agenda is attached.', attachment: { filename: 'atlas-agenda.pdf', type: 'application/pdf', content: pdf('Atlas agenda') } },
    ],
  },
  {
    key: 'devis',
    subject: 'Website redesign quote — version 2',
    messages: [
      { from: 'sophie', text: 'Hello,\n\nPlease find attached version 2 of the quote, which now includes the blog migration and the training.\nHappy to discuss it.\n\nBest regards,', attachment: { filename: 'redesign-quote-v2.pdf', type: 'application/pdf', content: pdf('Redesign quote v2') } },
      { from: 'alice', to: ['sophie'], text: 'Hi Sophie,\n\nThanks for the quote. Could you break down the "blog migration" item? The rest works for us.' },
    ],
  },
  {
    key: 'candidature',
    subject: 'Application — React Native developer',
    messages: [
      { from: 'nadia', text: 'Hello,\n\nI\'m applying for the React Native developer position.\nMy résumé is attached.\n\nKind regards,', attachment: { filename: 'resume-nadia-benali.pdf', type: 'application/pdf', content: pdf('Resume Nadia Benali') } },
      { from: 'alice', to: ['nadia'], text: 'Hi Nadia,\n\nThank you for your application. Would you be available on Thursday for a first video call?' },
      { from: 'nadia', to: ['alice'], text: 'Hello,\n\nThursday works well for me, any time after 2pm.\n\nHave a nice day,' },
    ],
  },
  {
    key: 'preprod',
    subject: 'Access to the staging server',
    messages: [
      { from: 'hugo', text: 'Hi Alice,\n\nCould you give me SSH access to staging? I need to check the cache configuration.' },
      { from: 'alice', to: ['hugo'], text: 'Done, your key is added. Access expires in 7 days.' },
      { from: 'hugo', to: ['alice'], text: 'Thanks, it works.' },
    ],
  },
  {
    key: 'bilan',
    subject: '2026 accounts — documents needed',
    messages: [
      { from: 'ines', text: 'Dear Ms Durand,\n\nTo close the 2026 accounts, I still need the November statements and the list of fixed assets.\n\nKind regards,', attachment: { filename: 'missing-documents.csv', type: 'text/csv; charset=utf-8', content: Buffer.from('Document;Status\nNovember statements;Missing\nFixed assets;Missing\n') } },
    ],
  },
  {
    key: 'meeting',
    subject: 'Meeting next week',
    messages: [
      { from: 'daniel', text: 'Hi Alice,\n\nAre you available on Tuesday afternoon to go through the integration plan?\n\nBest regards,' },
      { from: 'alice', to: ['daniel'], text: 'Hi Daniel,\n\nTuesday at 3pm works for me. I will send an invitation.' },
    ],
  },
  {
    key: 'propuesta',
    subject: 'Propuesta de colaboración',
    messages: [
      { from: 'laura', text: 'Hola Alice,\n\nTe escribo para proponerte una colaboración en el proyecto de traducción de la aplicación.\n\nUn saludo,' },
    ],
  },
  {
    key: 'retour',
    subject: 'Feedback on the mockup',
    messages: [
      { from: 'marco', text: 'Hi Alice,\n\nThe new mockup is much easier to read. Two remarks: the contrast of the secondary buttons and the size of the headings on mobile.' },
    ],
  },
];

const notifications = [
  (index) => ({ from: services.hosting, subject: 'New sign-in to your account', text: `We noticed a sign-in to your account from a new device.\nIf this wasn't you, change your password.\n\nReference: CNX-${10240 + index}` }),
  (index) => ({ from: services.billing, subject: `Invoice 2026-${String(4100 + index).padStart(5, '0')} is ready`, text: 'Hello,\n\nYour invoice is attached.\n\nThe Billing team', attachment: { filename: `invoice-2026-${4100 + index}.pdf`, type: 'application/pdf', content: pdf(`Invoice ${4100 + index}`) } }),
  (index) => ({ from: services.parcel, subject: 'Your parcel is out for delivery', text: `Your parcel CE${880000 + index}FR will be delivered today between 9am and 1pm.` }),
  (index) => ({ from: services.calendar, subject: 'Reminder: team meeting tomorrow at 10:00', text: `Weekly team meeting\nTomorrow, 10:00 – 10:45\nRivoli room\n\nEvent #${index}` }),
  (index) => ({ from: services.bank, subject: 'Your monthly statement is ready', text: `Your statement for this month is ready in online banking.\nReference: STM-${2000 + index}` }),
  (index) => ({ from: services.newsletter, subject: `The Tech Wire — #${40 + index}`, text: `What mattered this week. Read the issue: https://www.techwire.example/issue/${40 + index}`, html: newsletterHtml(40 + index), inlineImages: [{ type: 'image/png', filename: 'logo.png', contentId: 'logo@techwire.example', content: LOGO_PNG }], headers: listHeaders('techwire.example') }),
  (index) => ({ from: services.shop, subject: `Black Friday: ${20 + (index % 4) * 10}% off everything`, text: 'Our lamps and lights are on sale until Sunday.\n\nSee the deals: https://lumiere.example/black-friday', headers: [...listHeaders('lumiere.example'), 'X-Mailin-Campaign: 4211'] }),
  (index) => ({ from: services.orders, subject: `Your order ${4521 + index} has shipped`, text: `Your order ${4521 + index} is on its way. Track it: https://lumiere.example/track/${4521 + index}` }),
  (index) => ({ from: services.forum, subject: '[Rust Users Forum] New reply in "Async and lifetimes"', text: `Hugo replied to "Async and lifetimes".\n\nReply #${index}`, headers: ['List-Id: <rust.forum.example>', 'Auto-Submitted: auto-generated'] }),
  (index) => ({ from: services.login, subject: `${String(482910 + index * 7).slice(-6)} is your sign-in code`, text: 'Enter this code to sign in. It expires in 10 minutes.', headers: ['Auto-Submitted: auto-generated'] }),
];

class Mailboxes {
  folders = new Map();

  add(user, folder, message) {
    const key = `${user}\u0000${folder}`;
    if (!this.folders.has(key)) this.folders.set(key, { user, folder, messages: [] });
    this.folders.get(key).messages.push(message);
  }

  byUser() {
    const result = new Map();
    for (const { user, folder, messages } of this.folders.values()) {
      if (!result.has(user)) result.set(user, new Map());
      result.get(user).set(folder, messages.sort((left, right) => left.date - right.date));
    }
    return result;
  }
}

function personOf(key) {
  return key === 'alice' ? alice : people[key];
}

function addConversation(mailboxes, conversation, start, random) {
  const ids = [];
  let date = start;
  conversation.messages.forEach((message, index) => {
    date = new Date(date.getTime() + (20 + random() * 240) * MINUTE);
    const from = personOf(message.from);
    const to = (message.to ?? ['alice']).map(personOf);
    const cc = (message.cc ?? []).map(personOf);
    const messageId = `${conversation.key}.${index}.${start.getTime()}@example.com`;
    const raw = buildMessage({
      from,
      to,
      cc,
      subject: index === 0 ? conversation.subject : `Re: ${conversation.subject}`,
      date,
      messageId,
      inReplyTo: ids.at(-1),
      references: ids,
      text: message.text + (message.from === 'alice' ? signature(alice) : signature(from)),
      attachments: message.attachment ? [message.attachment] : [],
    });
    ids.push(messageId);
    const fromAlice = message.from === 'alice';
    const isLast = index === conversation.messages.length - 1;
    mailboxes.add(alice.email, fromAlice ? 'Sent' : 'INBOX', {
      raw,
      date,
      flags: fromAlice || !isLast ? ['\\Seen'] : random() < 0.5 ? ['\\Seen'] : [],
    });
  });
}

function addNotification(mailboxes, folder, index, date, random) {
  const template = notifications[index % notifications.length](index);
  const raw = buildMessage({
    from: template.from,
    to: [alice],
    subject: template.subject,
    date,
    messageId: `notification.${index}.${date.getTime()}@example.com`,
    text: template.text,
    html: template.html,
    inlineImages: template.inlineImages ?? [],
    attachments: template.attachment ? [template.attachment] : [],
    headers: template.headers,
  });
  const flags = random() < 0.75 ? ['\\Seen'] : [];
  if (random() < 0.05) flags.push('\\Flagged');
  mailboxes.add(alice.email, folder, { raw, date, flags });
}

export function buildDataset({ inboxSize, now = new Date() }) {
  const random = createRandom(20261108);
  const mailboxes = new Mailboxes();

  conversations.forEach((conversation, index) => {
    const start = new Date(now.getTime() - (index * 1.7 + 0.3) * DAY);
    addConversation(mailboxes, conversation, start, random);
  });

  const generated = Math.max(0, inboxSize - conversations.reduce((total, conversation) => total + conversation.messages.length, 0));
  const span = inboxSize > 500 ? 28 * DAY : 45 * DAY;
  for (let index = 0; index < generated; index += 1) {
    const date = new Date(now.getTime() - (index / Math.max(generated, 1)) * span - random() * 2 * 60 * MINUTE - 5 * MINUTE);
    addNotification(mailboxes, 'INBOX', index, date, random);
  }

  for (let index = 0; index < 30; index += 1) {
    addNotification(mailboxes, 'Archive', 1000 + index, new Date(now.getTime() - (10 + index * 2) * DAY), random);
  }
  for (let index = 0; index < 4; index += 1) {
    addNotification(mailboxes, 'Trash', 2000 + index, new Date(now.getTime() - (index + 1) * DAY), random);
  }
  for (let index = 0; index < 3; index += 1) {
    const date = new Date(now.getTime() - (index + 2) * DAY);
    mailboxes.add(alice.email, 'Junk', {
      raw: buildMessage({ from: services.spam, to: [alice], subject: 'Congratulations, you have been selected!', date, messageId: `spam.${index}@promo-deals.example`, text: 'Click here to claim your reward.' }),
      date,
      flags: [],
    });
  }
  const draftDate = new Date(now.getTime() - 3 * 60 * MINUTE);
  mailboxes.add(alice.email, 'Drafts', {
    raw: buildMessage({ from: alice, to: [people.marco], subject: 'Re: Feedback on the mockup', date: draftDate, messageId: `draft.1@example.com`, text: 'Hi Marco,\n\nThanks for the notes, I\'m reworking' }),
    date: draftDate,
    flags: ['\\Seen', '\\Draft'],
  });
  for (let index = 0; index < 6; index += 1) {
    const date = new Date(now.getTime() - (index * 3 + 1) * DAY);
    mailboxes.add(alice.email, 'Projects.Clients', {
      raw: buildMessage({ from: people.claire, to: [alice], subject: `Client report — week ${46 - index}`, date, messageId: `client.${index}@lumen.example`, text: 'Hello,\n\nHere is this week\'s report: on track, next delivery on Friday.' + signature(people.claire) }),
      date,
      flags: ['\\Seen'],
    });
  }
  for (let index = 0; index < 5; index += 1) {
    const date = new Date(now.getTime() - (index + 1) * 5 * 60 * MINUTE);
    mailboxes.add(bob.email, 'INBOX', {
      raw: buildMessage({ from: people.julien, to: [bob], subject: `Weekly check-in #${index + 1}`, date, messageId: `bob.${index}@mail.example`, text: 'Hi Bob,\n\nShall we catch up tomorrow morning?' + signature(people.julien) }),
      date,
      flags: index > 1 ? ['\\Seen'] : [],
    });
  }
  return mailboxes.byUser();
}
