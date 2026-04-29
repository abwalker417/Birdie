#!/usr/bin/env bash
set -euo pipefail
if ! command -v whiptail >/dev/null 2>&1; then
  apt-get update && apt-get install -y whiptail curl
fi
DEFAULT_CTID="117"
DEFAULT_HOSTNAME="birdie"
DEFAULT_CORES="2"
DEFAULT_MEMORY="4096"
DEFAULT_DISK="16"
DEFAULT_BRIDGE="vmbr0"
DEFAULT_STORAGE="local-lvm"
DEFAULT_OS_TEMPLATE="local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst"
msg(){ echo "[Birdie] $*"; }
CTID=$(whiptail --inputbox "Container ID" 8 60 "$DEFAULT_CTID" 3>&1 1>&2 2>&3) || exit 1
HOSTNAME=$(whiptail --inputbox "Hostname" 8 60 "$DEFAULT_HOSTNAME" 3>&1 1>&2 2>&3) || exit 1
PASSWORD=$(whiptail --passwordbox "Root password for the new LXC" 8 60 3>&1 1>&2 2>&3) || exit 1
CORES=$(whiptail --inputbox "CPU cores" 8 60 "$DEFAULT_CORES" 3>&1 1>&2 2>&3) || exit 1
MEMORY=$(whiptail --inputbox "RAM in MB" 8 60 "$DEFAULT_MEMORY" 3>&1 1>&2 2>&3) || exit 1
DISK=$(whiptail --inputbox "Disk size in GB" 8 60 "$DEFAULT_DISK" 3>&1 1>&2 2>&3) || exit 1
BRIDGE=$(whiptail --inputbox "Bridge" 8 60 "$DEFAULT_BRIDGE" 3>&1 1>&2 2>&3) || exit 1
STORAGE=$(whiptail --inputbox "Storage" 8 60 "$DEFAULT_STORAGE" 3>&1 1>&2 2>&3) || exit 1
NETMODE=$(whiptail --menu "Networking" 12 60 2 "dhcp" "Use DHCP" "static" "Use static IP in CIDR format" 3>&1 1>&2 2>&3) || exit 1
if [[ "$NETMODE" == "static" ]]; then
  IP_CIDR=$(whiptail --inputbox "Static IP/CIDR (example: 192.168.68.50/24)" 8 70 3>&1 1>&2 2>&3) || exit 1
  GATEWAY=$(whiptail --inputbox "Gateway" 8 60 3>&1 1>&2 2>&3) || exit 1
  NET0="name=eth0,bridge=${BRIDGE},ip=${IP_CIDR},gw=${GATEWAY}"
else
  NET0="name=eth0,bridge=${BRIDGE},ip=dhcp"
fi
pct create "$CTID" "$DEFAULT_OS_TEMPLATE" --hostname "$HOSTNAME" --password "$PASSWORD" --cores "$CORES" --memory "$MEMORY" --rootfs "$STORAGE:${DISK}" --net0 "$NET0" --features nesting=1 --unprivileged 1
pct start "$CTID"
sleep 8
pct exec "$CTID" -- bash -lc 'apt-get update -qq && apt-get install -y curl git sudo'
pct push "$CTID" ./install.sh /root/install.sh
pct exec "$CTID" -- bash -lc 'chmod +x /root/install.sh && /root/install.sh'
IP=$(pct exec "$CTID" -- hostname -I | awk '{print $1}') || true
msg "App URL: http://${IP}:8080"
msg "API docs: http://${IP}:8080/api/docs"
