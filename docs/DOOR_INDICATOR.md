# Door unlock flow & “green light” (planned)

## Mental model (agreed)

- **Strike** is driven by the **Kisi controller** — not wired in series with the reader.
- **Reader** is on the **network** (e.g. PoE); **app unlock** goes **server → Kisi API → controller → strike**. Same final hop for both paths.

## Target behavior

1. **Inputs that request unlock**
   - **App “Unlock” button** (existing): member app → our API → Kisi unlock → controller → strike.
   - **Future (optional):** a **local device** that can read **NFC / tap** (or similar) and **signal our backend** (HTTP/webhook). We then call **Kisi** to unlock — same chain as the button, not a parallel hack on the strike.

2. **Green indicator (our hardware, not the Kisi reader LED)**  
   On **every successful unlock** — whether the request came from the **button** or from **any other path** we add later — we trigger the **same** “success” output (e.g. PoE/LAN gadget, relay, smart light) so the **green** means: *our system recorded an unlock success*.  
   That way members get consistent feedback **without** depending on the Kisi reader’s own LED.

3. **Security**  
   Any webhook or device that can request unlock must use **strong authentication** (shared secret, signed payloads, etc.) — design this when we wire the gadget.

## Implementation notes (for later)

- Hook the green signal off the **single** place we already treat as success (e.g. after Kisi unlock succeeds in `/api/kisi/unlock`, and any other server path that legitimately opens the door).
- Optional: small **IoT / relay** on the LAN that accepts a **server-side** ping only (no public unlock URL without auth).
