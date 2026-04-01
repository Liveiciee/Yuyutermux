#!/data/data/com.termux/files/usr/bin/bash
# =============================================
# edit.sh - File Manager Wizard untuk Yuyutermux
# =============================================

cd "$HOME/Yuyutermux" || { echo "❌ Folder tidak ditemukan!"; exit 1; }

# Warna
G='\033[1;32m'; R='\033[1;31m'; Y='\033[1;33m'; B='\033[1;34m'; N='\033[0m'

# Dependencies
command -v nano &>/dev/null || { echo -e "${Y}⚠️ Install: pkg install nano${N}"; exit 1; }
HAS_FZF=$(command -v fzf &>/dev/null && echo 1 || echo 0)
HAS_CLIP=$(command -v termux-clipboard-set &>/dev/null && echo 1 || echo 0)

# ========== HELPERS ==========
confirm() { read -p "$1 (y/t): " a; [[ "$a" =~ ^[Yy]$ ]]; }

# ========== CARI FILE ==========
echo -e "${Y}🔍 Mencari file...${N}"

FILES=$(find . -maxdepth 3 -type f \( \
    -name "*.py" -o -name "*.sh" -o -name "*.js" -o -name "*.html" \
    -o -name "*.css" -o -name "*.json" -o -name "*.txt" -o -name "*.md" \
    -o -name "*.conf" -o -name "*.yml" -o -name "*.yaml" -o -name "*.toml" \
    \) -not -path "*/.git/*" -not -path "*/node_modules/*" -not -path "*/__pycache__/*" \
    2>/dev/null | sort)

[ -z "$FILES" ] && { echo -e "${R}Tidak ada file ditemukan.${N}"; exit 1; }

# ========== PILIH FILE ==========
if [ "$HAS_FZF" = 1 ]; then
    SELECTED=$(echo "$FILES" | fzf --prompt="Pilih: " --preview='head -20 {}' --height=70%)
else
    mapfile -t arr <<< "$FILES"
    for i in "${!arr[@]}"; do
        printf "%3d) %s\n" $((i+1)) "${arr[$i]#./}"
    done
    read -p "Nomor: " n
    [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge 1 ] && [ "$n" -le "${#arr[@]}" ] \
        && SELECTED="${arr[$((n-1))]}" \
        || { echo -e "${R}Invalid.${N}"; exit 1; }
fi

[ -z "$SELECTED" ] && { echo -e "${Y}Batal.${N}"; exit 0; }
echo -e "\n${G}▸ $SELECTED${N}\n"

# ========== MENU ==========
CANCEL_OPT=$([ "$HAS_CLIP" = 1 ] && echo 5 || echo 4)

echo "1) ✏️  Edit (nano)"
echo "2) 🗑️  Hapus"
echo "3) 🧹 Kosongkan + edit"
[ "$HAS_CLIP" = 1 ] && echo "4) 📋 Copy ke clipboard"
echo "$CANCEL_OPT) ❌ Batal"
read -p "Pilih: " action

# ========== AKSI ==========
case $action in
    1)
        nano "$SELECTED"
        ;;
    2)
        confirm "Yakin hapus?" && { rm -i "$SELECTED"; echo -e "${G}Dihapus.${N}"; }
        ;;
    3)
        if confirm "Kosongkan file?"; then
            > "$SELECTED"
            echo -e "${G}Dikosongkan.${N}"
            nano "$SELECTED"
        fi
        ;;
    4)
        if [ "$HAS_CLIP" = 1 ]; then
            size=$(wc -c < "$SELECTED" | tr -d ' ')
            if [ "${size:-0}" -gt 1048576 ]; then
                echo -e "${Y}⚠️ File besar ($((size/1024)) KB)${N}"
                confirm "Lanjutkan?" || exit 0
            fi
            termux-clipboard-set "$(cat "$SELECTED")" &
            echo -e "${G}✅ Menyalin...${N}"
        else
            echo -e "${Y}Batal.${N}"
        fi
        ;;
    $CANCEL_OPT|*)
        echo -e "${Y}Batal.${N}"
        ;;
esac
