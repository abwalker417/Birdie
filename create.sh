#!/usr/bin/env bash
# Birdie — Proxmox LXC creator (tteck-style)
# Run on the Proxmox host:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/abwalker417/Birdie/main/create.sh)"

set -euo pipefail

REPO_RAW_BASE="https://raw.githubusercontent.com/abwalker417/Birdie/main"

YW="\033[33m"; GN="\033[1;92m"; RD="\033[01;31m"; CL="\033[m"
msg()  { echo -e "${GN}[Birdie]${CL} $*"; }
warn() { echo -e "${YW}[Birdie]${CL} $*"; }
fail() { echo -e "${RD}[Birdie ERROR]${CL} $*" >&2; exit 1; }

# ─── Preflight ──────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  fail "Must be run as root on the Proxmox host"
fi
if ! command -v pct >/dev/null 2>&1; then
  fail "pct not found — this script must run on a Proxmox VE host"
fi
if ! command -v whiptail >/dev/null 2>&1; then
  msg "Installing whiptail + curl"
  apt-get update -qq && apt-get install -y whiptail curl >/dev/null
fi

# ─── Banner ─────────────────────────────────────────────────────────────────
clear
cat <<'EOF'

  ██████╗ ██╗██████╗ ██████╗ ██╗███████╗
  ██╔══██╗██║██╔══██╗██╔══██╗██║██╔════╝
  ██████╔╝██║██████╔╝██║  ██║██║█████╗
  ██╔══██╗██║██╔══██╗██║  ██║██║██╔══╝
  ██████╔╝██║██║  ██║██████╔╝██║███████╗
  ╚═════╝ ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝╚══════╝
  Self-Hosted Golf Tracker — LXC Creator

EOF

# ─── Defaults ───────────────────────────────────────────────────────────────
DEFAULT_CTID="$(pvesh get /cluster/nextid 2>/dev/null || echo 200)"
DEFAULT_HOSTNAME="birdie"
DEFAULT_CORES="2"
DEFAULT_MEMORY="2048"
DEFAULT_DISK="12"
DEFAULT_BRIDGE="vmbr0"
DEFAULT_STORAGE="local-lvm"

# ─── Prompts (every run) ────────────────────────────────────────────────────
CTID=$(whiptail --title "Container ID" --inputbox "Choose a CT ID for the new LXC" 9 60 "$DEFAULT_CTID" 3>&1 1>&2 2>&3) || exit 1
HOSTNAME=$(whiptail --title "Hostname" --inputbox "Hostname for the LXC" 9 60 "$DEFAULT_HOSTNAME" 3>&1 1>&2 2>&3) || exit 1
PASSWORD=$(whiptail --title "Root password" --passwordbox "Root password for the LXC (you'll need this for pct console access)" 9 60 3>&1 1>&2 2>&3) || exit 1
[[ -z "$PASSWORD" ]] && fail "Password cannot be empty"

CORES=$(whiptail --title "CPU cores" --inputbox "Number of CPU cores" 9 60 "$DEFAULT_CORES" 3>&1 1>&2 2>&3) || exit 1
MEMORY=$(whiptail --title "Memory" --inputbox "RAM in MB" 9 60 "$DEFAULT_MEMORY" 3>&1 1>&2 2>&3) || exit 1
DISK=$(whiptail --title "Disk" --inputbox "Disk size in GB" 9 60 "$DEFAULT_DISK" 3>&1 1>&2 2>&3) || exit 1

# Storage picker — list real Proxmox storages that accept rootdir
STORAGE_OPTS=()
while IFS= read -r line; do
  name=$(awk '{print $1}' <<<"$line")
  type=$(awk '{print $2}' <<<"$line")
  STORAGE_OPTS+=("$name" "$type")
done < <(pvesm status -content rootdir 2>/dev/null | tail -n +2)
if [[ ${#STORAGE_OPTS[@]} -eq 0 ]]; then
  STORAGE=$(whiptail --title "Storage" --inputbox "Storage pool for rootfs" 9 60 "$DEFAULT_STORAGE" 3>&1 1>&2 2>&3) || exit 1
else
  STORAGE=$(whiptail --title "Storage" --menu "Pick the storage pool for rootfs" 18 60 10 "${STORAGE_OPTS[@]}" 3>&1 1>&2 2>&3) || exit 1
fi

BRIDGE=$(whiptail --title "Bridge" --inputbox "Network bridge" 9 60 "$DEFAULT_BRIDGE" 3>&1 1>&2 2>&3) || exit 1
VLAN=$(whiptail --title "VLAN tag" --inputbox "VLAN tag (leave blank for none)" 9 60 "" 3>&1 1>&2 2>&3) || exit 1

NETMODE=$(whiptail --title "Networking" --menu "Choose IP mode" 12 60 2 \
  "dhcp" "Use DHCP" \
  "static" "Use static IP (CIDR + gateway)" \
  3>&1 1>&2 2>&3) || exit 1

if [[ "$NETMODE" == "static" ]]; then
  IP_CIDR=$(whiptail --title "Static IP" --inputbox "Static IP in CIDR format (e.g. 192.168.68.50/24)" 9 70 3>&1 1>&2 2>&3) || exit 1
  GATEWAY=$(whiptail --title "Gateway" --inputbox "Default gateway (e.g. 192.168.68.1)" 9 60 3>&1 1>&2 2>&3) || exit 1
fi

# ─── Confirm ────────────────────────────────────────────────────────────────
SUMMARY="Container ID  : $CTID
Hostname      : $HOSTNAME
CPU cores     : $CORES
Memory (MB)   : $MEMORY
Disk (GB)     : $DISK
Storage       : $STORAGE
Bridge        : $BRIDGE
VLAN tag      : ${VLAN:-(none)}
Network mode  : $NETMODE"
[[ "$NETMODE" == "static" ]] && SUMMARY="$SUMMARY
Static IP     : $IP_CIDR
Gateway       : $GATEWAY"

whiptail --title "Confirm" --yesno "Create the LXC with these settings?

$SUMMARY" 22 70 || { msg "Cancelled"; exit 0; }

# ─── Find Debian 12 template ────────────────────────────────────────────────
msg "Updating template list"
pveam update >/dev/null 2>&1 || true
TEMPLATE=$(pveam available --section system 2>/dev/null | awk '/debian-12/ {print $2}' | sort -V | tail -1)
[[ -z "$TEMPLATE" ]] && fail "No debian-12 template found in 'pveam available'"

# Pick a template storage that supports vztmpl
TPL_STORAGE=$(pvesm status -content vztmpl 2>/dev/null | awk 'NR>1 {print $1; exit}')
[[ -z "$TPL_STORAGE" ]] && TPL_STORAGE="local"

LOCAL_TPL="${TPL_STORAGE}:vztmpl/${TEMPLATE}"
if ! pveam list "$TPL_STORAGE" 2>/dev/null | grep -q "$TEMPLATE"; then
  msg "Downloading $TEMPLATE to $TPL_STORAGE"
  pveam download "$TPL_STORAGE" "$TEMPLATE" >/dev/null
fi

# ─── Build net0 string ──────────────────────────────────────────────────────
NET0="name=eth0,bridge=${BRIDGE}"
[[ -n "$VLAN" ]] && NET0="${NET0},tag=${VLAN}"
if [[ "$NETMODE" == "static" ]]; then
  NET0="${NET0},ip=${IP_CIDR},gw=${GATEWAY}"
else
  NET0="${NET0},ip=dhcp"
fi

# ─── Create + start ─────────────────────────────────────────────────────────
msg "Creating LXC $CTID"
pct create "$CTID" "$LOCAL_TPL" \
  --hostname "$HOSTNAME" \
  --password "$PASSWORD" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --rootfs "${STORAGE}:${DISK}" \
  --net0 "$NET0" \
  --features nesting=1 \
  --unprivileged 1 \
  --onboot 1 \
  --start 0 \
  || fail "pct create failed"

msg "Starting LXC $CTID"
pct start "$CTID" || fail "pct start failed"

# Wait for the container to come up
msg "Waiting for container to be reachable"
for i in $(seq 1 30); do
  if pct exec "$CTID" -- true 2>/dev/null; then break; fi
  sleep 1
done

# Wait for DHCP/static + DNS to be ready (curl needs network)
msg "Waiting for network"
for i in $(seq 1 30); do
  if pct exec "$CTID" -- bash -lc "getent hosts raw.githubusercontent.com >/dev/null" 2>/dev/null; then break; fi
  sleep 1
done

# ─── Bootstrap inside container ─────────────────────────────────────────────
msg "Bootstrapping curl + sudo + locales"
pct exec "$CTID" -- bash -lc "
  set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl sudo locales ca-certificates >/dev/null
" || fail "Bootstrap failed inside container"

msg "Running install.sh from GitHub"
pct exec "$CTID" -- bash -lc "
  set -e
  curl -fsSL ${REPO_RAW_BASE}/install.sh -o /root/install.sh
  bash /root/install.sh
" || fail "Birdie install failed inside container"

# ─── Done ───────────────────────────────────────────────────────────────────
IP=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}' | xargs)
echo
msg "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
msg "Birdie is ready"
msg "  CT ID      : $CTID"
msg "  Hostname   : $HOSTNAME"
msg "  App URL    : http://${IP:-<lxc-ip>}:8080"
msg "  API docs   : http://${IP:-<lxc-ip>}:8080/api/docs"
msg "  Shell      : pct exec $CTID -- bash"
msg "  Update     : pct exec $CTID -- bash /opt/birdie/app/update.sh"
msg "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
