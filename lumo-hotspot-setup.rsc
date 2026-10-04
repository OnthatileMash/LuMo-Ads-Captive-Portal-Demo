# =====================================================================
# LuMo Ads -- MikroTik RB951Ui-2HnD Hotspot Setup (Captive Portal Demo)
# =====================================================================
# Confirmed role: this router is the WHOLE thing at a site -- router,
# DHCP server, NAT, hotspot/captive-portal AND Wi-Fi AP, on its own.
#
# IMPORTANT -- do this reset FIRST, in Winbox, before running this script:
#   System -> Reset Configuration -> tick "No Default Configuration" -> Reset
# Your router currently has RouterOS's "CAP configuration" default applied
# (wireless handed off to CAPsMAN, DHCP CLIENT on the bridge, no DHCP
# server/NAT/hotspot at all) -- that's built for a device acting as a pure
# Wi-Fi extension of someone else's network, not a standalone all-in-one
# router. "No Default Configuration" gives a genuinely blank router with
# no bridge, no CAPsMAN bindings, nothing -- so this script can build the
# whole thing cleanly instead of fighting leftover CAP-mode config.
#
# HOW TO RUN (after the reset above): Winbox -> New Terminal -> paste the
# whole script, or Files -> upload this .rsc -> New Terminal ->
#   /import file-name=lumo-hotspot-setup.rsc
#
# EDIT FIRST if these don't match your plan:
#   ether1            the WAN port (to your ISP modem/upline) -- rest of
#                     the Ethernet ports + wlan1 become the hotspot LAN
#   192.168.0.250     the router's LAN/hotspot address
#   192.168.0.5       IP of the machine running the LuMo backend (server/)
#   "LuMo Free WiFi"  the SSID
# =====================================================================

# --- 1. Interface lists (WAN vs LAN) ------------------------------------
/interface list add name=WAN comment="lumo"
/interface list add name=LAN comment="lumo"
/interface list member add list=WAN interface=ether1
/interface list member add list=LAN interface=ether2
/interface list member add list=LAN interface=ether3
/interface list member add list=LAN interface=ether4
/interface list member add list=LAN interface=ether5
/interface list member add list=LAN interface=wlan1

# --- 2. Wireless SSID (plain config -- no CAPsMAN involved here) -------
/interface wireless set [find default-name=wlan1] disabled=no mode=ap-bridge \
    band=2ghz-b/g/n ssid="LuMo Free WiFi" frequency=auto

# --- 3. Bridge for the hotspot LAN (everything except ether1/WAN) ------
/interface bridge add name=bridge-lumo comment="lumo"
/interface bridge port add bridge=bridge-lumo interface=ether2
/interface bridge port add bridge=bridge-lumo interface=ether3
/interface bridge port add bridge=bridge-lumo interface=ether4
/interface bridge port add bridge=bridge-lumo interface=ether5
/interface bridge port add bridge=bridge-lumo interface=wlan1

# --- 4. WAN: get internet from the upstream modem/ISP ------------------
/ip dhcp-client add interface=ether1 disabled=no comment="lumo"

# --- 5. LAN/hotspot addressing + DHCP for connecting clients ------------
/ip address add address=192.168.0.250/24 interface=bridge-lumo comment="lumo"
/ip pool add name=pool-hotspot ranges=192.168.0.10-192.168.0.240
/ip dhcp-server add name=dhcp-hotspot interface=bridge-lumo \
    address-pool=pool-hotspot lease-time=1h disabled=no
/ip dhcp-server network add address=192.168.0.0/24 gateway=192.168.0.250 \
    dns-server=192.168.0.250,8.8.8.8 comment="lumo"
/ip dns set allow-remote-requests=yes

# --- 6. NAT: let hotspot clients reach the internet over WAN ------------
/ip firewall nat add chain=srcnat out-interface-list=WAN action=masquerade \
    comment="lumo: NAT to WAN"

# --- 7. Basic firewall (same shape as RouterOS's own router defaults) --
/ip firewall filter add chain=input action=accept connection-state=established,related,untracked comment="lumo: accept established/related"
/ip firewall filter add chain=input action=drop connection-state=invalid comment="lumo: drop invalid"
/ip firewall filter add chain=input action=accept protocol=icmp comment="lumo: accept ICMP"
/ip firewall filter add chain=input action=drop in-interface-list=!LAN comment="lumo: drop input not from LAN"
/ip firewall filter add chain=forward action=fasttrack-connection connection-state=established,related comment="lumo: fasttrack"
/ip firewall filter add chain=forward action=accept connection-state=established,related,untracked comment="lumo: accept established/related"
/ip firewall filter add chain=forward action=drop connection-state=invalid comment="lumo: drop invalid"
/ip firewall filter add chain=forward action=drop connection-state=new connection-nat-state=!dstnat in-interface-list=WAN comment="lumo: drop unsolicited from WAN"

# --- 8. Hotspot server profile + server ----------------------------------
/ip hotspot profile add name=profile-lumo hotspot-address=192.168.0.250 \
    login-by=http-pap html-directory=hotspot use-radius=no
/ip hotspot add name=hotspot-lumo interface=bridge-lumo profile=profile-lumo \
    address-pool=pool-hotspot disabled=no idle-timeout=5m keepalive-timeout=none

# --- 9. Shared "guest" account ------------------------------------------
# Everyone who completes registration + consent + the ad logs in as this
# ONE hotspot account -- LuMo's own backend (not RouterOS) is what records
# who each real visitor actually is. Change "lumoguest" before going live
# and keep it in sync with server/server.js (GUEST_USERNAME / GUEST_PASSWORD).
/ip hotspot user profile add name=profile-guest shared-users=254 \
    rate-limit=4M/4M session-timeout=1h idle-timeout=10m keepalive-timeout=none
/ip hotspot user add name=guest password=lumoguest profile=profile-guest \
    server=hotspot-lumo

# --- 10. Walled garden: let NOT-YET-LOGGED-IN devices reach the portal --
# Pick ONE of the two setups below depending on where the portal runs
# (see SETUP.md "Hosting: local vs. GitHub Pages / cloud"):

# (A) Portal + backend both run locally on the same LAN (server/ in this
#     package, on e.g. 192.168.0.5) -- IP-based, also covers the API's
#     non-standard port 3000 which a domain-based entry would not:
/ip hotspot walled-garden ip-list add dst-address=192.168.0.5 action=accept \
    comment="lumo: local portal server"

# (B) Frontend served from GitHub Pages / another public HTTPS host
#     instead -- domain-based (works over HTTPS via SNI). Uncomment and
#     edit if you go this route, and ALSO add an ip-list entry (A-style)
#     for wherever the backend API itself ends up hosted:
# /ip hotspot walled-garden add dst-host=onthatilemash.github.io action=allow \
#     comment="lumo: GitHub Pages frontend"

:put "All-in-one router+DHCP+NAT+hotspot+Wi-Fi config applied from a blank router."
:put "NEXT STEP: replace /hotspot/login.html on this router with"
:put "router/login.html from this package (see SETUP.md step 2)."
:put "Router's management address: 192.168.0.250 -- reconnect Winbox there."
