mail := "tools/mail-server/mail-server.sh"

default:
    @just --list

greenmail *args:
    {{mail}} start {{args}}

stalwart:
    {{mail}} oauth

dovecot *args:
    {{mail}} performance {{args}}

seed *args:
    {{mail}} seed {{args}}

status:
    @{{mail}} status

stop:
    {{mail}} stop
