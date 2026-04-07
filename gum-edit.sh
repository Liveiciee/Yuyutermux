#!/data/data/com.termux/files/usr/bin/bash
# gum-edit.sh - File Manager Wizard v4.0.2 (Gum Edition, stable)

set -o nounset -o pipefail
trap 'cleanup; exit 0' EXIT
trap 'cleanup; exit 130' INT

EDITOR="${EDITOR:-nano}"
TARGET_DIR="${PWD:-$HOME/Yuyutermux}"
SCAN_DEPTH=5
RESPECT_GITIGNORE=1
RUNNING=1

HAS_GIT=0; HAS_CLIP=0; HAS_MD5=0; HAS_TREE=0
command -v git &>/dev/null && HAS_GIT=1
command -v termux-clipboard-set &>/dev/null && HAS_CLIP=1
command -v md5sum &>/dev/null && HAS_MD5=1
command -v tree &>/dev/null && HAS_TREE=1

CLEANUP_FILES=()
cleanup() { for f in "${CLEANUP_FILES[@]}"; do rm -f "$f" 2>/dev/null; done; }

confirm() { gum confirm "$1" 2>/dev/null; }

stat_size() { stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null || echo 0; }
stat_mtime() { stat -c"%Y-%m-%d %H:%M" "$1" 2>/dev/null || stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$1" 2>/dev/null || echo "unknown"; }

is_ignored() {
    [[ "$RESPECT_GITIGNORE" = 0 ]] && return 1
    [[ "$HAS_GIT" = 0 ]] && return 1
    [[ -d ".git" ]] || return 1
    git check-ignore -q "$1" 2>/dev/null
}

scan_files() {
    gum style --border rounded --margin "0 1" --padding "0 1" --foreground 212 "🔍 Scanning (depth=$SCAN_DEPTH)..."

    local tmpfile=$(mktemp); CLEANUP_FILES+=("$tmpfile")

    find . -maxdepth "$SCAN_DEPTH" -type f \
        ! -path '*/\.*' ! -path '*/node_modules/*' ! -path '*/__pycache__/*' \
        ! -path '*/venv/*' ! -path '*/env/*' ! -path '*/.cache/*' \
        ! -path '*/dist/*' ! -path '*/build/*' ! -path '*/target/*' ! -path '*/.git/*' \
        \( \
           -name "*.py" -o -name "*.sh" -o -name "*.bash" -o \
           -name "*.js" -o -name "*.jsx" -o \
           -name "*.ts" -o -name "*.tsx" -o \
           -name "*.html" -o -name "*.htm" -o \
           -name "*.css" -o -name "*.scss" -o -name "*.sass" -o -name "*.less" -o \
           -name "*.json" -o -name "*.txt" -o \
           -name "*.md" -o -name "*.markdown" -o \
           -name "*.yml" -o -name "*.yaml" -o -name "*.toml" -o \
           -name "*.xml" -o -name "*.csv" -o -name "*.log" -o \
           -name "*.conf" -o -name "*.ini" -o -name "*.cfg" -o \
           -name "*.sql" -o -name "*.php" -o -name "*.rb" -o \
           -name "*.go" -o -name "*.rs" -o -name "*.zig" -o \
           -name "*.java" -o -name "*.c" -o -name "*.cpp" -o \
           -name "*.h" -o -name "*.hpp" -o -name "*.vue" -o \
           -name "Dockerfile" -o -name "Makefile" -o \
           -name "makefile" -o -name "*.mk" \
        \) 2>/dev/null > "$tmpfile"

    local result=$(mktemp); CLEANUP_FILES+=("$result")
    local ignored=0

    while IFS= read -r f; do
        if is_ignored "$f"; then ignored=$((ignored+1)); continue; fi
        [[ -r "$f" ]] && echo "$f"
    done < "$tmpfile" > "$result"

    sort -o "$result" "$result"

    local final=$(wc -l < "$result")
    [[ $ignored -gt 0 ]] && gum style --foreground 240 "⚠️ $ignored ignored"
    gum style --foreground 212 "✓ $final files found"

    cat "$result"
    return $(( final == 0 ? 1 : 0 ))
}

select_file() {
    local files_list="$1"
    [[ -z "$files_list" ]] && { gum style --foreground 160 "No files"; return 1; }
    local selected
    # Trim whitespace and newline; ensure we get a clean path
    selected=$(printf "%s\n" "$files_list" | gum filter --height=20 --width=100 --placeholder "Select file..." | xargs)
    if [[ -n "$selected" && -f "$selected" ]]; then
        echo "$selected"
        return 0
    else
        # If selection is invalid, return failure
        return 1
    fi
}

file_menu() {
    local file="$1"
    # Safety: if file doesn't exist or is not a regular file, abort
    if [[ ! -f "$file" ]]; then
        gum style --foreground 160 "Invalid file: $file"
        sleep 1
        return 1
    fi

    local size=$(stat_size "$file")
    local lines=$(wc -l < "$file" 2>/dev/null || echo 0)
    local mtime=$(stat_mtime "$file")
    local sz
    if [[ $size -lt 1024 ]]; then sz="${size}B"; elif [[ $size -lt 1048576 ]]; then sz="$((size/1024))KB"; else sz="$((size/1048576))MB"; fi

    while true; do
        clear
        gum style --border rounded --margin 1 --padding "0 2" --foreground 212 "📄 $(basename "$file")"
        gum style --foreground 240 "  📊 $lines lines | $sz | $mtime"
        echo ""
        action=$(gum choose --height=12 \
            "✏️  Edit" \
            "🧹  Clear" \
            "👁️  Preview" \
            "🔍  Search" \
            "📜  Tail" \
            "📊  Stats" \
            "📋  Copy to clipboard" \
            "📂  Folder" \
            "🔄  Rename" \
            "📄  Duplicate" \
            "🔗  Symlink" \
            "🗑️  Delete" \
            "🔙  Back")
        case "$action" in
            "✏️  Edit") "$EDITOR" "$file"; return 0 ;;
            "🧹  Clear") confirm "Clear $lines lines?" && { : > "$file"; "$EDITOR" "$file"; return 0; } ;;
            "👁️  Preview") head -50 "$file" | gum pager ;;
            "🔍  Search")
                local kw=$(gum input --placeholder "Search term")
                [[ -n "$kw" ]] && grep -n -F --color=always "$kw" "$file" | gum pager
                ;;
            "📜  Tail") tail -20 "$file" | gum pager ;;
            "📊  Stats")
                echo "Lines: $(wc -l < "$file")" | gum format
                echo "Words: $(wc -w < "$file")" | gum format
                echo "Chars: $(wc -m < "$file")" | gum format
                [[ $HAS_MD5 -eq 1 ]] && echo "MD5: $(md5sum "$file" | cut -d' ' -f1)" | gum format
                gum input --placeholder "Press Enter" >/dev/null
                ;;
            "📋  Copy to clipboard")
                if [[ $HAS_CLIP -eq 1 ]]; then
                    termux-clipboard-set < "$file" && gum style --foreground 212 "Copied"
                else
                    gum style --foreground 160 "termux-clipboard-set not installed"
                fi
                gum input --placeholder "Press Enter" >/dev/null
                ;;
            "📂  Folder")
                local dir=$(dirname "$file")
                ls -la "$dir" | gum pager
                ;;
            "🔄  Rename")
                local newname=$(gum input --placeholder "New name" --value "$(basename "$file")")
                [[ -n "$newname" && ! -e "$(dirname "$file")/$newname" ]] && mv "$file" "$(dirname "$file")/$newname" && gum style --foreground 212 "Renamed" && return 0
                ;;
            "📄  Duplicate")
                local dup=$(gum input --placeholder "Duplicate as")
                [[ -n "$dup" && ! -e "$dup" ]] && cp "$file" "$dup" && gum style --foreground 212 "Duplicated" && return 0
                ;;
            "🔗  Symlink")
                local link=$(gum input --placeholder "Symlink name")
                [[ -n "$link" && ! -e "$link" ]] && ln -s "$file" "$link" && gum style --foreground 212 "Symlink created"
                ;;
            "🗑️  Delete")
                confirm "Delete $(basename "$file")?" && rm "$file" && gum style --foreground 212 "Deleted" && return 0
                ;;
            "🔙  Back") return 2 ;;
        esac
    done
}

browse_mode() {
    while true; do
        clear
        gum style --border rounded --margin 1 --padding "0 2" --foreground 212 "📂 BROWSE MODE"
        action=$(gum choose --height=12 \
            "📁 Select folder" \
            "🌳 Tree view" \
            "➕ Create file" \
            "📁 Create folder" \
            "📋 Copy" \
            "✂️  Move/Rename" \
            "🗑️  Delete folder" \
            "🔍 Search" \
            "📊 Disk usage" \
            "⚙️  Gitignore (toggle)" \
            "🔙 Back")
        case "$action" in
            "📁 Select folder")
                local dir=$(find . -type d -not -path '*/\.*' 2>/dev/null | gum filter --placeholder "Select folder" | xargs)
                [[ -n "$dir" && -d "$dir" ]] && cd "$dir" && gum style --foreground 212 "Now in $(pwd)" && return 2
                ;;
            "🌳 Tree view")
                if [[ $HAS_TREE -eq 1 ]]; then tree -L 2; else find . -maxdepth 2 -type d; fi
                gum input --placeholder "Press Enter" >/dev/null
                ;;
            "➕ Create file")
                local fname=$(gum input --placeholder "Filename")
                [[ -n "$fname" ]] && touch "$fname" && "$EDITOR" "$fname" && return 2
                ;;
            "📁 Create folder")
                local dname=$(gum input --placeholder "Folder name")
                [[ -n "$dname" ]] && mkdir -p "$dname"
                ;;
            "📋 Copy")
                local src=$(gum input --placeholder "Source")
                local dst=$(gum input --placeholder "Destination")
                [[ -n "$src" && -n "$dst" ]] && cp -r "$src" "$dst"
                ;;
            "✂️  Move/Rename")
                local old=$(gum input --placeholder "Old")
                local new=$(gum input --placeholder "New")
                [[ -n "$old" && -n "$new" ]] && mv "$old" "$new"
                ;;
            "🗑️  Delete folder")
                local df=$(gum input --placeholder "Folder to delete")
                [[ -n "$df" && -d "$df" ]] && confirm "Delete $df?" && rm -rf "$df"
                ;;
            "🔍 Search")
                local kw=$(gum input --placeholder "Search term")
                [[ -n "$kw" ]] && find . -maxdepth 3 -type f -iname "*$kw*" 2>/dev/null | gum pager
                ;;
            "📊 Disk usage")
                du -sh . 2>/dev/null | gum format
                find . -maxdepth 2 -type f -exec du -h {} + 2>/dev/null | sort -rh | head -10 | gum pager
                ;;
            "⚙️  Gitignore (toggle)")
                RESPECT_GITIGNORE=$((1 - RESPECT_GITIGNORE))
                gum style --foreground 212 "Gitignore: $([[ $RESPECT_GITIGNORE = 1 ]] && echo ON || echo OFF)"
                ;;
            "🔙 Back") return 1 ;;
        esac
    done
}

main() {
    cd "$TARGET_DIR" 2>/dev/null || { gum style --foreground 160 "Cannot cd to $TARGET_DIR"; exit 1; }
    local FILES
    FILES=$(scan_files) || true
    while [[ $RUNNING -eq 1 ]]; do
        if [[ -z "$FILES" ]]; then
            gum style --foreground 240 "No files found"
            local opt=$(gum choose "Browse" "Rescan" "Quit")
            case "$opt" in
                Browse) browse_mode; FILES=$(scan_files) || true ;;
                Rescan) FILES=$(scan_files) || true ;;
                Quit) break ;;
            esac
            continue
        fi
        local SEL
        SEL=$(select_file "$FILES") || { FILES=$(scan_files) || true; continue; }
        # Additional safety: ensure SEL is a file that exists
        if [[ -z "$SEL" || ! -f "$SEL" ]]; then
            gum style --foreground 160 "Invalid selection, rescanning..."
            FILES=$(scan_files) || true
            continue
        fi
        file_menu "$SEL"
        local ret=$?
        [[ $ret -eq 0 ]] && FILES=$(scan_files) || true
        [[ $ret -eq 3 ]] && break
    done
    clear
    gum style --foreground 212 "👋 Goodbye!"
}

main "$@"
