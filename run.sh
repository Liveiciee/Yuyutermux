#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail  # STRICT MODE

# ==========================================
# KONFIGURASI STRICT
# ==========================================
readonly APP_DIR="$HOME/Yuyutermux"
readonly PIDFILE="$APP_DIR/server.pid"
readonly LOGFILE="$APP_DIR/server.log"
readonly OLDLOG="$APP_DIR/server.log.old"
readonly TOKEN_FILE="$APP_DIR/.auth_token"
readonly BACKUP_DIR="$APP_DIR/.backups"
readonly HEALTH_URL="http://127.0.0.1:5000/api/health"
readonly PORT=5000
readonly API_BIN="$APP_DIR/zig-out/bin/api"
readonly MAX_LOG_SIZE=$((5*1024*1024))  # 5MB rotate
readonly MIN_BATTERY=15
readonly WATCHDOG_INTERVAL=30

# ==========================================
# WARNA
# ==========================================
declare -r G='\033[0;32m' R='\033[0;31m' Y='\033[1;33m' B='\033[0;34m' C='\033[0;36m' N='\033[0m'

# ==========================================
# UTILS STRICT
# ==========================================
log() { echo -e "[$(date '+%H:%M:%S')] $1" | tee -a "$LOGFILE"; }
die() { echo -e "${R}💀 FATAL: $1${N}" >&2; exit 1; }

# ==========================================
# SYSTEM DETECTION
# ==========================================
detect_cores() {
    nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1
}

get_battery() {
    termux-battery-status 2>/dev/null | grep -oP '"percentage": \K\d+' || echo 100
}

get_free_ram() {
    free -m 2>/dev/null | awk '/^Mem:/ {print $7}' || echo 0
}

# ==========================================
# TOKEN MANAGEMENT STRICT
# ==========================================
generate_token() {
    if command -v openssl &>/dev/null; then
        openssl rand -hex 32 2>/dev/null || openssl rand -base64 32
    else
        head -c 64 /dev/urandom | sha256sum | head -c 64
    fi
}

load_token() {
    if [[ -z "${YUYUTERMUX_TOKEN:-}" ]]; then
        if [[ -f "$TOKEN_FILE" ]]; then
            export YUYUTERMUX_TOKEN
            YUYUTERMUX_TOKEN="$(cat "$TOKEN_FILE")"
            [[ -n "$YUYUTERMUX_TOKEN" ]] || {
                export YUYUTERMUX_TOKEN="$(generate_token)"
                echo "$YUYUTERMUX_TOKEN" > "$TOKEN_FILE"
                chmod 600 "$TOKEN_FILE"
            }
        else
            export YUYUTERMUX_TOKEN="$(generate_token)"
            echo "$YUYUTERMUX_TOKEN" > "$TOKEN_FILE"
            chmod 600 "$TOKEN_FILE"
            log "${G}🔐 New token generated${N}"
        fi
    fi
}

show_token() {
    load_token
    echo -e "${Y}🔑 Auth Token: ${G}${YUYUTERMUX_TOKEN}${N}"
    echo -e "${Y}   (Simpan baik-baik, token ini untuk login)${N}"
}

# ==========================================
# STRICT CHECKS
# ==========================================
strict_checks() {
    [[ -x "$API_BIN" ]] || die "Binary tidak executable atau belum ada. Jalankan build dulu."

    local free_space
    free_space=$(df "$APP_DIR" | tail -1 | awk '{print $4}')
    [[ ${free_space:-0} -gt 10240 ]] || die "Storage penuh! ($((free_space/1024))MB tersisa)"

    local batt
    batt=$(get_battery)
    [[ "$batt" -gt "$MIN_BATTERY" ]] || die "Baterai $batt%! Charge dulu bro ⛔"

    local ram
    ram=$(get_free_ram)
    [[ "$ram" -gt 50 ]] || die "RAM tinggal ${ram}MB! Tutup app dulu"

    log "${G}✅ All systems GO (Bat:${batt}%, RAM:${ram}MB)${N}"
}

# ==========================================
# LOG ROTATION STRICT
# ==========================================
rotate_logs() {
    if [[ -f "$LOGFILE" ]] && [[ "$(stat -f%z "$LOGFILE" 2>/dev/null || stat -c%s "$LOGFILE" 2>/dev/null || echo 0)" -gt "$MAX_LOG_SIZE" ]]; then
        mv "$LOGFILE" "$OLDLOG"
        gzip -f "$OLDLOG" 2>/dev/null &
        log "${Y}📋 Log rotated${N}"
    fi
}

# ==========================================
# AUTO BACKUP STRICT
# ==========================================
auto_backup() {
    mkdir -p "$BACKUP_DIR"
    local backup_file="$BACKUP_DIR/backup_$(date +%Y%m%d_%H%M%S).tar.gz"

    tar -czf "$backup_file" -C "$APP_DIR" \
        "$(basename "$TOKEN_FILE")" \
        src build.zig run.sh 2>/dev/null || true

    ls -t "$BACKUP_DIR"/backup_*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f

    [[ -f "$backup_file" ]] && log "${C}💾 Backup: $(basename "$backup_file")${N}"
}

# ==========================================
# PROCESS MANAGEMENT STRICT
# ==========================================
is_running() {
    [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null
}

get_pid() { cat "$PIDFILE" 2>/dev/null || echo 0; }

kill_zombies() {
    local pids
    pids=$(pgrep -f "$API_BIN" 2>/dev/null || true)
    for pid in $pids; do
        [[ "$pid" != "$(get_pid)" ]] && kill -9 "$pid" 2>/dev/null && log "${Y}💀 Killed zombie $pid${N}"
    done
}

port_check() {
    for i in {1..3}; do
        (echo >/dev/tcp/127.0.0.1/$PORT) 2>/dev/null && return 0
        sleep 1
    done
    return 1
}

health_check() {
    local retries=0
    while [[ $retries -lt 10 ]]; do
        if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.5
        ((retries++))
    done
    return 1
}

# ==========================================
# WATCHDOG DAEMON
# ==========================================
start_watchdog() {
    (
        while true; do
            sleep "$WATCHDOG_INTERVAL"
            if [[ -f "$PIDFILE" ]]; then
                local pid
                pid="$(cat "$PIDFILE" 2>/dev/null || true)"
                if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
                    log "${R}🚨 WATCHDOG: Server crash detected!${N}"
                    rm -f "$PIDFILE"
                    sleep 2
                    "$0" start_auto &
                    exit 0
                fi

                local ram
                ram=$(get_free_ram)
                [[ "$ram" -lt 20 ]] && {
                    log "${R}⚠️ WATCHDOG: RAM kritis (${ram}MB), restarting...${N}"
                    "$0" restart &
                    exit 0
                }
            fi
        done
    ) &>/dev/null &
    echo $! > "$APP_DIR/.watchdog.pid"
}

stop_watchdog() {
    [[ -f "$APP_DIR/.watchdog.pid" ]] && kill "$(cat "$APP_DIR/.watchdog.pid")" 2>/dev/null || true
    rm -f "$APP_DIR/.watchdog.pid"
}

# ==========================================
# NOTIFICATION
# ==========================================
notify() {
    termux-notification --title "Yuyutermux" --content "$1" 2>/dev/null || true
    termux-toast "$1" 2>/dev/null || true
}

# ==========================================
# COMPILATION STRICT
# ==========================================
smart_compile() {
    cd "$APP_DIR" || die "Cannot cd to $APP_DIR"

    log "${Y}🔨 Rebuilding via zig build...${N}"

    if zig build -Dtarget=aarch64-linux-musl -Doptimize=ReleaseSmall 2>&1 | tee -a "$LOGFILE"; then
        [[ -x "$API_BIN" ]] || die "Build selesai tapi binary belum ada: $API_BIN"
        log "${G}✅ Compiled (ReleaseSmall)${N}"
        strip "$API_BIN" 2>/dev/null || true
    else
        die "Compilation failed!"
    fi
}

# ==========================================
# ACTIONS
# ==========================================
do_stop() {
    is_running || { log "${Y}⚠️  Already stopped${N}"; return 0; }

    local pid
    pid=$(get_pid)
    log "${Y}[*] Stopping Zig server (PID: $pid)...${N}"

    kill "$pid" 2>/dev/null || true
    for i in {1..5}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
    done

    kill -9 "$pid" 2>/dev/null || true

    rm -f "$PIDFILE"
    stop_watchdog
    notify "Server stopped"
    log "${G}✅ Stopped${N}"
}

do_start() {
    local start_type="${1:-manual}"
    [[ "$start_type" == "auto" ]] && log "${Y}🔄 Auto-restart triggered${N}"

    is_running && { log "${Y}⚠️  Already running!${N}"; return 1; }

    rotate_logs
    strict_checks
    load_token
    auto_backup
    smart_compile
    kill_zombies

    cd "$APP_DIR" || die "Cannot cd to $APP_DIR"

    log "${B}[*] Starting Zig Server...${N}"
    log "${Y}⚠️  Binding ke 127.0.0.1:$PORT${N}"

    export YUYUTERMUX_TOKEN

    nohup nice -n 10 "$API_BIN" >>"$LOGFILE" 2>&1 &
    local pid=$!
    echo "$pid" > "$PIDFILE"

    sleep 2
    if ! port_check; then
        rm -f "$PIDFILE"
        die "Port $PORT not responding! Check logs."
    fi

    if ! health_check; then
        log "${Y}⚠️  Health check timeout, tapi port aktif${N}"
    fi

    start_watchdog
    notify "Server UP (PID:$pid)"

    local ip
    ip=$(ip -4 addr show wlan0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1 || true)
    echo -e "${G}✅ PID:$pid | http://localhost:$PORT${N}"
    [[ -n "${ip:-}" ]] && echo -e "${C}📱 http://$ip:$PORT${N}"
    echo -e "${Y}🔑 ${YUYUTERMUX_TOKEN:0:20}...${N}"
    echo -e "${C}💾 Log: tail -f $LOGFILE${N}"
}

do_restart() {
    log "${Y}[*] Restarting...${N}"
    do_stop
    sleep 2
    do_start "restart"
}

do_status() {
    clear
    echo "╔════════════════════════════════════╗"
    echo "║     Yuyutermux Zig Status"
    echo "╚════════════════════════════════════╝"
    echo ""

    if is_running; then
        local pid uptime mem threads
        pid=$(get_pid)
        uptime=$(ps -o etime= -p "$pid" 2>/dev/null | xargs || echo "?")
        mem=$(ps -o rss= -p "$pid" 2>/dev/null | xargs || echo 0)
        threads=$(ls /proc/$pid/task 2>/dev/null | wc -l || echo 0)

        echo -e "${G}● RUNNING${N}"
        echo "  PID:      $pid"
        echo "  Uptime:   $uptime"
        echo "  Memory:   $((mem/1024))MB"
        echo "  Threads:  $threads"
        echo "  Port:     $PORT"
    else
        echo -e "${R}● STOPPED${N}"
    fi

    echo ""
    echo -e "${C}System:${N}"
    echo "  Battery:  $(get_battery)%"
    echo "  Free RAM: $(get_free_ram)MB"
    echo "  Storage:  $(df -h "$APP_DIR" | tail -1 | awk '{print $4}')"
    [[ -f "$TOKEN_FILE" ]] && echo "  Token:    $(wc -c <"$TOKEN_FILE") bytes"

    echo ""
    read -p "Enter to continue..."
}

do_log() {
    [[ -f "$LOGFILE" ]] || { echo -e "${R}❌ No log file${N}"; read -p "Enter to continue..."; return; }
    echo -e "${B}📄 Last 20 lines:${N}\n---"
    tail -n 20 "$LOGFILE"
    echo "---"
    read -p "Enter to continue..."
}

# ==========================================
# MAIN
# ==========================================
command="${1:-menu}"

case "$command" in
    start|start_auto) do_start "$command" ;;
    stop) do_stop ;;
    restart) do_restart ;;
    status) do_status ;;
    compile) smart_compile ;;
    logs) tail -f "$LOGFILE" ;;
    token) load_token; echo "$YUYUTERMUX_TOKEN" ;;
    *)
        while true; do
            clear
            echo "╔════════════════════════════════════╗"
            echo "║     Yuyutermux Zig Server Manager"
            echo "╚════════════════════════════════════╝"
            echo ""
            is_running && echo -e "${G}● RUNNING${N} (PID:$(get_pid))" || echo -e "${R}● STOPPED${N}"
            echo ""
            echo "1) 🚀 Start (with checks)"
            echo "2) ⛔ Stop"
            echo "3) 🔄 Restart"
            echo "4) 📊 Status"
            echo "5) 📋 Logs (follow)"
            echo "6) 🔨 Compile Only"
            echo "7) 🔑 Show Token"
            echo "8) ❌ Exit"
            echo ""
            read -p "Pilih: " choice

            case "$choice" in
                1) do_start; read ;;
                2) do_stop; read ;;
                3) do_restart; read ;;
                4) do_status ;;
                5) clear; echo "Ctrl+C to exit..."; tail -f "$LOGFILE" ;;
                6) smart_compile; read ;;
                7) load_token; echo "Token: $YUYUTERMUX_TOKEN"; read ;;
                8) exit 0 ;;
            esac
        done
        ;;
esac
