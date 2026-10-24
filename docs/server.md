<sub>[Kavana docs](README.md) › Running your own server</sub>

# Your own server

Running your own Kavana means one Node program and one folder for its state. There's nothing to install from npm, no database and no build step, which makes it about as small as a web app with accounts and push notifications can be. This page takes you from a clone to a copy your phone can use, with HTTPS and reminders.

## What you need

- **Node 22 or newer.** I've run it on 22 and 24.
- **HTTPS with a domain name**, for anyone but you on the same machine. Browsers only allow the service worker and notifications on a secure page, and on iPhones and iPads the Home Screen app needs it too.
- **A reverse proxy** in front of it for the HTTPS, like Caddy or nginx, or a tunnel.

## Run it

```bash
git clone https://github.com/franz-rosenzweig/kavana.git
cd kavana
mkdir -p "$HOME/kavana-state"
KAVANA_STATE="$HOME/kavana-state" KAVANA_URL=https://focus.example.com/ node server.js
```

It says `kavana on http://127.0.0.1:8460` and makes its push keys and admin token in the state folder the first time. Open http://127.0.0.1:8460 on the same machine and it works right away, since browsers treat localhost as secure. For everyone else, put it behind HTTPS (below).

## The settings

Everything is set with environment variables:

| Variable | What it does | Default |
| --- | --- | --- |
| `KAVANA_STATE` | the state folder (always set it: the default is a folder on my own server) | |
| `KAVANA_PORT` | the port | `8460` |
| `KAVANA_HOST` | the address it listens on. Keep it on localhost behind a proxy. On any other address it also listens on 127.0.0.1, for the CLI | `127.0.0.1` |
| `KAVANA_URL` | your public address, with https. Push services get it as the contact for your server, and the CLI prints it with new passwords | my address |
| `KAVANA_PATH` | the cookie path, when Kavana lives under a path like `/kavana/` | `/` |
| `KAVANA_MINUTE_MS` | how long a "minute" is, for tests only | `60000` |
| `KAVANA_NAP_GRACE_MS` | how long someone napping together may be out of Kavana before every kitten wanders off, for tests only | `15000` |

## HTTPS and a path

Kavana's pages use relative addresses, so it can live at the root of a domain or under a path. With Caddy, at the root it's just:

```
focus.example.com {
	reverse_proxy 127.0.0.1:8460 {
		header_up CF-Connecting-IP {remote_host}
	}
}
```

Under a path, the address has to end in a slash, the proxy strips the path before passing the request on, and `KAVANA_PATH=/kavana/` keeps the sign-in cookie to that path:

```
example.com {
	redir /kavana /kavana/ 308
	handle_path /kavana/* {
		reverse_proxy 127.0.0.1:8460 {
			header_up CF-Connecting-IP {remote_host}
		}
	}
}
```

The `header_up` line matters. Kavana limits sign-ups and sign-ins per IP address, and when a request comes from localhost it takes the visitor's address from the `CF-Connecting-IP` header, which Cloudflare sets by itself. Behind any other proxy, set it as above, or every visitor looks like the proxy and they all share one limit. Kavana marks the sign-in cookie Secure when the proxy says the visitor came over HTTPS (`X-Forwarded-Proto: https`, which Caddy sends), or when the request came through Cloudflare.

## Keep it running

`deploy/kavana.service` is the systemd user unit I use, as a starting point. Change its `WorkingDirectory`, the path to `node` in `ExecStart`, and `KAVANA_STATE`, `KAVANA_URL` and `KAVANA_PATH` to yours, copy it to `~/.config/systemd/user/`, and run `systemctl --user enable --now kavana`. `loginctl enable-linger` keeps it running when you're logged out.

To update, `git pull` and restart it. Browsers check the files each time Kavana opens (they're sent with an ETag and `private, no-cache`), so everyone gets the new version on their next open. I run mine from a second git worktree pinned to a commit, so editing the code never touches the live app: deploying is `git -C <live worktree> checkout --detach <commit> && systemctl --user restart kavana`.

## The state folder

Everything the server knows is in `KAVANA_STATE`, and none of it is in git. Kavana writes its files readable only by you (mode 600), and the folder should be private too (`chmod 700`):

- `state.json`: accounts (name, password hash, friend code, friends), sign-ins, devices with reminders on, the pings waiting to be sent, daily reminder times, and the groups napping together (each dropped 12 hours after it ends).
- `docs/<name>.json`: each account's synced data, with its revision.
- `analytics.json`: the usage counts per day.
- `vapid.json`: the push key pair, made on the first run. Back it up: if you lose it, everyone has to turn reminders on again.
- `admin-token`: the CLI's key, made on the first run.

The server writes these itself, a moment after each change and again when it stops, so stop it before you edit or restore anything by hand.

## Accounts and the CLI

People make their own accounts in the app. `bin/kavana` is for the rest, and it talks to the running server on localhost with the token from the state folder, so give it the same `KAVANA_STATE`, and `KAVANA_PORT` if you changed it (with `KAVANA_URL`, the passwords it prints come with your address):

```
kavana add-user <name>         make an account, prints the password
kavana reset-password <name>   new password, signs out their devices
kavana remove-user <name>      delete them and everything of theirs on the server
kavana users                   list accounts
kavana admin <name> [off]      give an account admin rights, or take them away
kavana friends <a> <b>         make two accounts friends (people can also swap codes in the app)
kavana unfriend <a> <b>
kavana test-push <name>        send a test reminder to their signed-in devices
```

The passwords it makes up are three plain words, like `maple-otter-lantern`, which are easy to type on an iPad. The admin API only answers on localhost, never through a proxy, and only with the token.

## Limits

- Sign-ups: 3 per IP address an hour, and 30 a day in all. Sign-ins: 5 wrong tries per IP address every 15 minutes.
- At most 2,000 accounts, 5,000 devices with reminders, 20 friends each, and 1 MB of synced data per account. Nobody should get there: the app keeps each history under 800 KB by folding the oldest blocks into a summary ([how](DEVELOPING.md#the-engines-rules)).
- Push only goes to the real push services (Apple, Google, Mozilla and Microsoft), so nobody can point your server at another address.

If something here doesn't work on your setup, feel free to open an issue. For the code itself and the tests, see [Developing Kavana](DEVELOPING.md).

<sub>Next: [Developing Kavana](DEVELOPING.md) →</sub>
