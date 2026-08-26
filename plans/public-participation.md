# Public participation runbook

The Gate computer is the only application bridge between participant phones and
the lighting network. Phones send bounded intentions; they never receive
controller addresses, patch documents, credentials, or arbitrary configuration.

## Roles and modes

- **Operator**: the loopback desktop UI or the private operator credential.
- **Moderator**: participant UI plus the complete video-submission queue.
- **Participant**: the public surface and only that device's submissions.
- **Private**: remote phones are view-only. Every backend restart returns here.
- **Effects**: operator-allowlisted effects and optional drawing.
- **Curated**: Effects plus allowlisted saved scenes and optional video links.

Authorization is checked by the Rust server. Hiding operator buttons is not a
security boundary. Credentials grant a role for the current connection; a
remembered client ID never grants authority.

## Before doors

1. Start the backend and confirm Public participation says `private`.
2. Open the participant link on a phone connected to `Gate-Play`.
3. Confirm the phone cannot see Settings, Connect, controllers, or other users'
   submissions.
4. Enable Effects, choose the allowed effects, and leave Strobe disabled unless
   the operator explicitly wants it.
5. Stress drawing from several phones and confirm the per-connection limits.
6. If using video links, prefer Manual approval. Trusted domains match exact
   hostnames or subdomains; `youtube.com.evil.example` does not match.
7. During a DJ set, press `Lock public now` or switch the mode to Private.
8. Rotate participant/moderator links after the event or if either is shared
   beyond the intended audience.

## Network assumptions

`Gate-Play` may reach only TCP `192.168.10.10:9520`, DNS/DHCP, and optional
internet. It must not reach the management VLAN, lighting controllers, or other
guest devices. Keep sACN bound to the lighting/show interface and do not route
lighting multicast into the crowd VLAN.
