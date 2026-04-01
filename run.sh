#!/data/data/com.termux/files/usr/bin/bash

# ========== KONFIGURASI ==========
PIDFILE="$HOME/Yuyutermux/server.pid"
LOGFILE="$HOME/Yuyutermux/server.log"
PORT=5000
APP_DIR="$HOME/Yuyutermux"
SW_FILE="$APP_DIR/static/service-worker.js"

# ========== WARNA ==========
G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; B='\033[0;34m'; N='\033[0m'

# ========== DEPENDENCY CHECK ==========
command -v waitress-serve &>/dev/null || {
    echo -e "${R}❌ waitress-serve tidak ditemukan. Install: pip install waitress${N}"
    exit 1
}
cd "$APP_DIR" || exit 1

# ========== HELPERS ==========
is_running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }
get_pid()    { cat "$PIDFILE" 2>/dev/null; }

port_busy() {
    netstat -tun 2>/dev/null | grep -q ":$PORT "
}

port_pid() {
    netstat -tunp 2>/dev/null | grep ":$PORT " | awk '{print $NF}' | grep -oP '^\d+' | head -1
}

free_port() {
    if command -v fuser &>/dev/null; then
        fuser -k "$PORT/tcp" 2>/dev/null
        sleep 1
        return
    fi
    local pid=$(port_pid)
    [ -n "$pid" ] && kill "$pid" 2>/dev/null && sleep 1
}

wait_kill() {
    for ((i=0; i<${2:-5}; i++)); do
        kill -0 "$1" 2>/dev/null || return 0
        sleep 1
    done
    return 1
}

show_ip() {
    local ip
    ip=$(ip -4 addr show wlan0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
    [ -n "$ip" ] && echo -e "${Y}📱 Dari HP lain: http://$ip:$PORT${N}"
}

pause() { echo -e "\n${Y}Tekan Enter...${N}"; read -r; }

# ========== ACTIONS ==========
do_stop() {
    is_running || { echo -e "${Y}⚠️  Server tidak berjalan${N}"; return 1; }
    local pid=$(get_pid)
    echo -e "${Y}[*] Stopping (PID: $pid)...${N}"
    kill "$pid" 2>/dev/null
    wait_kill "$pid" 5 || kill -9 "$pid" 2>/dev/null
    rm -f "$PIDFILE"
    echo -e "${G}✅ Server stopped${N}"
}

do_start() {
    [ -f "app.py" ] || { echo -e "${R}❌ app.py tidak ditemukan${N}"; return 1; }

    if port_busy; then
        echo -e "${Y}[*] Port $PORT masih nyangkut, dibersihin...${N}"
        free_port
        if port_busy; then
            echo -e "${Y}[*] Menunggu port release...${N}"
            for ((i=1; i<=10; i++)); do
                sleep 1
                port_busy || break
                echo -e "   ($i/10)"
            done
        fi
        if port_busy; then
            echo -e "${R}❌ Port $PORT gagal dibersihin${N}"
            echo -e "${Y}Coba manual: fuser -k $PORT/tcp${N}"
            return 1
        fi
    fi

    echo -e "${B}[*] Starting Waitress...${N}"
    nohup waitress-serve --host=0.0.0.0 --port="$PORT" app:app > "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    sleep 3

    if is_running; then
        echo -e "${G}✅ Started!${N}  PID: $(get_pid)  URL: http://localhost:$PORT"
        show_ip
    else
        echo -e "${R}❌ Failed to start${N}"
        rm -f "$PIDFILE"
        echo "--- Last 10 lines ---"
        tail -n 10 "$LOGFILE" 2>/dev/null || echo "(no log)"
        echo "---------------------"
    fi
}

do_restart() { do_stop && sleep 1 && do_start; }

do_status() {
    clear
    echo "========================================"
    echo "   Yuyutermux Status"
    echo "========================================"
    if is_running; then
        local pid=$(get_pid)
        echo -e "${G}✅ RUNNING${N}  PID: $pid  Port: $PORT"
        local up=$(ps -o etime= -p "$pid" 2>/dev/null | xargs)
        [ -n "$up" ] && echo "   Uptime: $up"
        [ -f "$LOGFILE" ] && echo "   Log: $(du -h "$LOGFILE" | cut -f1)"
    else
        echo -e "${R}❌ NOT RUNNING${N}"
    fi
    if port_busy; then
        echo -e "   Port $PORT: ${R}BUSY${N} ($(port_pid))"
    else
        echo -e "   Port $PORT: ${G}FREE${N}"
    fi
    
    # Tampilkan versi cache saat ini
    if [ -f "$SW_FILE" ]; then
        local ver=$(grep -oP "yuyutermux-v\K\d+" "$SW_FILE")
        echo -e "   SW Cache: ${B}v${ver:-?}${N}"
    fi
    pause
}

do_log() {
    [ -f "$LOGFILE" ] || { echo -e "${R}❌ No log file${N}"; pause; return; }
    echo -e "${B}📄 Last 20 lines:${N}\n---"
    tail -n 20 "$LOGFILE"
    echo "---"
    pause
}

do_bust_cache() {
    echo -e "${B}[*] Busting Service Worker Cache...${N}"
    
    if [ ! -f "$SW_FILE" ]; then
        echo -e "${R}❌ service-worker.js tidak ditemukan di $SW_FILE${N}"
        pause
        return 1
    fi

    # Ambil versi sekarang
    local current=$(grep -oP "yuyutermux-v\K\d+" "$SW_FILE")
    
    if [ -z "$current" ]; then
        echo -e "${R}❌ Format cache tidak dikenali di service-worker.js${N}"
        pause
        return 1
    fi

    local new=$((current + 1))

    # Inject versi baru
    sed -i "s/yuyutermux-v${current}/yuyutermux-v${new}/" "$SW_FILE"

    echo -e "${G}✅ Cache Version: v${current} → v${new}${N}"
    echo -e "${Y}   (Server tidak perlu restart. Cukup refresh browser)${N}"
    pause
}

# ========== MAIN MENU ==========
while true; do
    clear
    echo "========================================"
    echo -e "${B}   Yuyutermux Server Manager${N}"
    echo "========================================"

    if is_running; then
        echo -e "${G}● Running${N} — PID: $(get_pid) — http://localhost:$PORT\n"
        echo "  [1] Stop"
        echo "  [2] Restart"
        echo "  [3] Status"
        echo "  [4] Log"
        echo "  [5] Bust Cache (Clear UI)"
        echo "  [6] Exit"
    else
        echo -e "${R}● Stopped${N}\n"
        echo "  [1] Start"
        echo "  [2] Exit"
    fi

    echo -en "\n${Y}Pilih: ${N}"; read -r

    if is_running; then
        case $REPLY in
            1) do_stop; break ;;
            2) do_restart; break ;;
            3) do_status ;;
            4) do_log ;;
            5) do_bust_cache ;;
            6) echo -e "${G}Server tetap berjalan${N}"; exit 0 ;;
        esac
    else
        case $REPLY in
            1) do_start; break ;;
            2) exit 0 ;;
        esac
    fi
done