#!/data/data/com.termux/files/usr/bin/bash
# gum-edit.sh - File Manager Wizard v4.1.0 (Gum Edition)
#
# A terminal file manager with TUI powered by Gum
# Supports editing, previewing, and managing files with ease

set -o errexit -o nounset -o pipefail
shopt -s nullglob

# ----------------------------------------
# Configuration
# ----------------------------------------
readonly SCRIPT_VERSION="4.1.0"
readonly EDITOR="${EDITOR:-nano}"
readonly TARGET_DIR="${PWD:-$HOME/Yuyutermux}"
readonly SCAN_DEPTH=5

# ----------------------------------------
# Global State
# ----------------------------------------
RESPECT_GITIGNORE=1
RUNNING=1
CLEANUP_FILES=()

# ----------------------------------------
# Capability Detection
# ----------------------------------------
HAS_GIT=0
HAS_CLIP=0
HAS_MD5=0
HAS_TREE=0

command -v git &>/dev/null && HAS_GIT=1
command -v termux-clipboard-set &>/dev/null && HAS_CLIP=1
command -v md5sum &>/dev/null && HAS_MD5=1
command -v tree &>/dev/null && HAS_TREE=1

# ----------------------------------------
# Signal Handlers & Cleanup
# ----------------------------------------
cleanup() {
    for file in "${CLEANUP_FILES[@]}"; do
        rm -f "$file" 2>/dev/null || true
    done
}

trap 'cleanup; exit 0' EXIT
trap 'cleanup; exit 130' INT TERM

# ----------------------------------------
# Utility Functions
# ----------------------------------------
confirm() {
    gum confirm "$1" 2>/dev/null
}

get_file_size() {
    stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null || echo "0"
}

get_file_mtime() {
    stat -c "%Y-%m-%d %H:%M" "$1" 2>/dev/null \
        || stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$1" 2>/dev/null \
        || echo "unknown"
}

format_size() {
    local size=$1
    if (( size < 1024 )); then
        echo "${size}B"
    elif (( size < 1048576 )); then
        echo "$(( size / 1024 ))KB"
    else
        echo "$(( size / 1048576 ))MB"
    fi
}

is_git_ignored() {
    (( RESPECT_GITIGNORE == 0 )) && return 1
    (( HAS_GIT == 0 )) && return 1
    [[ ! -d ".git" ]] && return 1
    git check-ignore -q "$1" 2>/dev/null
}

# ----------------------------------------
# File Scanning
# ----------------------------------------
scan_files() {
    local tmpfile result
    tmpfile=$(mktemp)
    CLEANUP_FILES+=("$tmpfile")
    
    # Tampilkan pesan simple dengan spinner inline
    printf "🔍 Scanning"
    
    # Jalankan find dengan counter sederhana
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
        \) 2>/dev/null | \
        while IFS= read -r line; do
            echo "$line"
            # Simple dot animation
            printf "." >&2
        done > "$tmpfile" 2>/dev/null

    printf "\r\033[K"  # Clear the dots
    
    result=$(mktemp)
    CLEANUP_FILES+=("$result")

    local ignored_count=0
    while IFS= read -r file; do
        if is_git_ignored "$file"; then
            (( ignored_count++ ))
            continue
        fi
        [[ -r "$file" ]] && printf "%s\n" "$file"
    done < "$tmpfile" > "$result"

    sort -o "$result" "$result"
    local final_count=$(wc -l < "$result")

    # Compact, clean output
    echo -n "📂 "
    gum style --foreground 212 --bold "$final_count files"
    [[ $ignored_count -gt 0 ]] && printf " (%d ignored)" "$ignored_count"
    echo

    cat "$result"
    return $(( final_count == 0 ? 1 : 0 ))
}

# ----------------------------------------
# File Selection
# ----------------------------------------
select_file() {
    local files_list="$1"
    local selected

    if [[ -z "$files_list" ]]; then
        gum style --foreground 160 "✗ No files available"
        return 1
    fi

    selected=$(printf "%s\n" "$files_list" \
        | gum filter \
            --height=20 \
            --width=100 \
            --placeholder "Type to filter and select a file..." \
            --no-fuzzy \
        | xargs)

    if [[ -n "$selected" && -f "$selected" ]]; then
        printf "%s\n" "$selected"
        return 0
    fi

    return 1
}

# ----------------------------------------
# File Menu Actions
# ----------------------------------------
show_preview() {
    local file="$1"
    head -50 "$file" | gum pager
}

show_search() {
    local file="$1"
    local keyword
    keyword=$(gum input --placeholder "Enter search term...")
    if [[ -n "$keyword" ]]; then
        grep -n -F --color=always "$keyword" "$file" | gum pager
    fi
}

show_stats() {
    local file="$1"
    local lines words chars md5_hash

    lines=$(wc -l < "$file")
    words=$(wc -w < "$file")
    chars=$(wc -m < "$file")

    printf "Lines: %s\n" "$lines" | gum format
    printf "Words: %s\n" "$words" | gum format
    printf "Characters: %s\n" "$chars" | gum format

    if (( HAS_MD5 == 1 )); then
        md5_hash=$(md5sum "$file" | cut -d' ' -f1)
        printf "MD5: %s\n" "$md5_hash" | gum format
    fi

    gum input --placeholder "Press Enter to continue..." >/dev/null
}

copy_to_clipboard() {
    local file="$1"
    if (( HAS_CLIP == 1 )); then
        if termux-clipboard-set < "$file"; then
            gum style --foreground 212 "✓ Copied to clipboard"
        else
            gum style --foreground 160 "✗ Failed to copy"
        fi
    else
        gum style --foreground 160 "✗ termux-clipboard-set not available"
    fi
    gum input --placeholder "Press Enter to continue..." >/dev/null
}

rename_file() {
    local file="$1"
    local dirname basename newname

    dirname=$(dirname "$file")
    basename=$(basename "$file")
    newname=$(gum input --placeholder "Enter new name..." --value "$basename")

    if [[ -n "$newname" && ! -e "$dirname/$newname" ]]; then
        mv "$file" "$dirname/$newname" \
            && gum style --foreground 212 "✓ Renamed to: $newname" \
            && return 0
    else
        gum style --foreground 160 "✗ Invalid name or file already exists"
        sleep 1
    fi
    return 1
}

duplicate_file() {
    local file="$1"
    local destination

    destination=$(gum input --placeholder "Enter duplicate path...")
    if [[ -n "$destination" && ! -e "$destination" ]]; then
        cp "$file" "$destination" \
            && gum style --foreground 212 "✓ Duplicated to: $destination" \
            && return 0
    else
        gum style --foreground 160 "✗ Invalid destination or file exists"
        sleep 1
    fi
    return 1
}

create_symlink() {
    local file="$1"
    local link_name

    link_name=$(gum input --placeholder "Enter symlink path...")
    if [[ -n "$link_name" && ! -e "$link_name" ]]; then
        ln -s "$file" "$link_name" \
            && gum style --foreground 212 "✓ Symlink created: $link_name"
    else
        gum style --foreground 160 "✗ Invalid path or file exists"
        sleep 1
    fi
}

delete_file() {
    local file="$1"
    if confirm "Delete '$(basename "$file")' permanently?"; then
        rm "$file" \
            && gum style --foreground 212 "✓ Deleted: $(basename "$file")" \
            && return 0
    fi
    return 1
}

# ----------------------------------------
# File Menu
# ----------------------------------------
file_menu() {
    local file="$1"
    local size lines mtime formatted_size action

    # Validate file exists
    if [[ ! -f "$file" ]]; then
        gum style --foreground 160 "✗ Invalid file: $file"
        sleep 1
        return 1
    fi

    size=$(get_file_size "$file")
    lines=$(wc -l < "$file" 2>/dev/null || echo "0")
    mtime=$(get_file_mtime "$file")
    formatted_size=$(format_size "$size")

    while true; do
        clear
        gum style \
            --border rounded \
            --margin 1 \
            --padding "0 2" \
            --foreground 212 \
            "📄 $(basename "$file")"

        gum style --foreground 240 "  📊 $lines lines | $formatted_size | $mtime"
        echo ""

        action=$(gum choose --height=12 \
            "✏️  Edit" \
            "🧹  Clear content" \
            "👁️  Preview (first 50 lines)" \
            "🔍  Search in file" \
            "📜  Tail (last 20 lines)" \
            "📊  Statistics" \
            "📋  Copy to clipboard" \
            "📂  Show parent folder" \
            "🔄  Rename" \
            "📄  Duplicate" \
            "🔗  Create symlink" \
            "🗑️  Delete" \
            "🔙  Back")

        case "$action" in
            "✏️  Edit")
                "$EDITOR" "$file"
                return 0
                ;;

            "🧹  Clear content")
                if confirm "Clear all $lines lines from file?"; then
                    : > "$file"
                    "$EDITOR" "$file"
                    return 0
                fi
                ;;

            "👁️  Preview (first 50 lines)")
                show_preview "$file"
                ;;

            "🔍  Search in file")
                show_search "$file"
                ;;

            "📜  Tail (last 20 lines)")
                tail -20 "$file" | gum pager
                ;;

            "📊  Statistics")
                show_stats "$file"
                ;;

            "📋  Copy to clipboard")
                copy_to_clipboard "$file"
                ;;

            "📂  Show parent folder")
                ls -la "$(dirname "$file")" | gum pager
                ;;

            "🔄  Rename")
                rename_file "$file" && return 0
                ;;

            "📄  Duplicate")
                duplicate_file "$file" && return 0
                ;;

            "🔗  Create symlink")
                create_symlink "$file"
                ;;

            "🗑️  Delete")
                delete_file "$file" && return 0
                ;;

            "🔙  Back")
                return 2
                ;;
        esac
    done
}

# ----------------------------------------
# Browse Mode
# ----------------------------------------
browse_mode() {
    local action dir

    while true; do
        clear
        gum style \
            --border rounded \
            --margin 1 \
            --padding "0 2" \
            --foreground 212 \
            "📂 BROWSE MODE - $(pwd)"

        action=$(gum choose --height=12 \
            "📁  Change directory" \
            "🌳  Tree view" \
            "➕  Create new file" \
            "📁  Create new folder" \
            "📋  Copy (file/folder)" \
            "✂️  Move/Rename" \
            "🗑️  Delete folder" \
            "🔍  Search by name" \
            "📊  Disk usage" \
            "⚙️  Toggle gitignore ($( (( RESPECT_GITIGNORE )) && echo "ON" || echo "OFF" ))" \
            "🔙  Back to main")

        case "$action" in
            "📁  Change directory")
                dir=$(find . -type d -not -path '*/\.*' 2>/dev/null \
                    | gum filter --placeholder "Select folder to enter..." \
                    | xargs)
                if [[ -n "$dir" && -d "$dir" ]]; then
                    cd "$dir" || continue
                    gum style --foreground 212 "✓ Now in: $(pwd)"
                    return 2
                fi
                ;;

            "🌳  Tree view")
                if (( HAS_TREE == 1 )); then
                    tree -L 2
                else
                    find . -maxdepth 2 -type d | sort
                fi
                gum input --placeholder "Press Enter to continue..." >/dev/null
                ;;

            "➕  Create new file")
                local filename
                filename=$(gum input --placeholder "Enter filename...")
                if [[ -n "$filename" ]]; then
                    touch "$filename"
                    "$EDITOR" "$filename"
                    return 2
                fi
                ;;

            "📁  Create new folder")
                local dirname
                dirname=$(gum input --placeholder "Enter folder name...")
                [[ -n "$dirname" ]] && mkdir -p "$dirname"
                ;;

            "📋  Copy (file/folder)")
                local src dst
                src=$(gum input --placeholder "Source path...")
                dst=$(gum input --placeholder "Destination path...")
                if [[ -n "$src" && -n "$dst" ]]; then
                    cp -r "$src" "$dst" \
                        && gum style --foreground 212 "✓ Copied" \
                        || gum style --foreground 160 "✗ Copy failed"
                    sleep 1
                fi
                ;;

            "✂️  Move/Rename")
                local old_path new_path
                old_path=$(gum input --placeholder "Current path...")
                new_path=$(gum input --placeholder "New path...")
                if [[ -n "$old_path" && -n "$new_path" ]]; then
                    mv "$old_path" "$new_path" \
                        && gum style --foreground 212 "✓ Moved" \
                        || gum style --foreground 160 "✗ Move failed"
                    sleep 1
                fi
                ;;

            "🗑️  Delete folder")
                local target_dir
                target_dir=$(gum input --placeholder "Folder to delete...")
                if [[ -n "$target_dir" && -d "$target_dir" ]]; then
                    if confirm "Delete '$target_dir' and ALL contents?"; then
                        rm -rf "$target_dir" \
                            && gum style --foreground 212 "✓ Deleted"
                    fi
                fi
                ;;

            "🔍  Search by name")
                local keyword
                keyword=$(gum input --placeholder "Search term...")
                if [[ -n "$keyword" ]]; then
                    find . -maxdepth 3 -type f -iname "*$keyword*" 2>/dev/null | gum pager
                fi
                ;;

            "📊  Disk usage")
                echo "Total directory size:" | gum format
                du -sh . 2>/dev/null | gum format
                echo ""
                echo "Largest files (top 10):" | gum format
                find . -maxdepth 2 -type f -exec du -h {} + 2>/dev/null \
                    | sort -rh \
                    | head -10 \
                    | gum pager
                ;;

            "⚙️  Toggle gitignore ($( (( RESPECT_GITIGNORE )) && echo "ON" || echo "OFF" ))")
                RESPECT_GITIGNORE=$(( 1 - RESPECT_GITIGNORE ))
                gum style --foreground 212 "✓ Gitignore respect: $( (( RESPECT_GITIGNORE )) && echo "ON" || echo "OFF" )"
                sleep 1
                ;;

            "🔙  Back to main")
                return 1
                ;;
        esac
    done
}

# ----------------------------------------
# Main Program
# ----------------------------------------
main() {
    # Change to target directory
    if ! cd "$TARGET_DIR" 2>/dev/null; then
        gum style --foreground 160 "✗ Cannot access directory: $TARGET_DIR"
        exit 1
    fi

    local files=""
    files=$(scan_files) || true

    while (( RUNNING == 1 )); do
        if [[ -z "$files" ]]; then
            gum style --foreground 240 "📭 No files found in current directory"
            local option
            option=$(gum choose "📂 Browse" "🔄 Rescan" "🚪 Quit")

            case "$option" in
                "📂 Browse")
                    browse_mode
                    files=$(scan_files) || true
                    ;;
                "🔄 Rescan")
                    files=$(scan_files) || true
                    ;;
                "🚪 Quit")
                    break
                    ;;
            esac
            continue
        fi

        local selected_file
        selected_file=$(select_file "$files") || {
            files=$(scan_files) || true
            continue
        }

        if [[ -z "$selected_file" || ! -f "$selected_file" ]]; then
            gum style --foreground 160 "✗ Invalid selection, rescanning..."
            files=$(scan_files) || true
            continue
        fi

        file_menu "$selected_file"
        local menu_result=$?

        # Refresh file list if changes were made
        if (( menu_result == 0 )); then
            files=$(scan_files) || true
        elif (( menu_result == 3 )); then
            break
        fi
    done

    clear
    gum style \
        --border rounded \
        --foreground 212 \
        --padding "1 3" \
        "👋 Goodbye!"
}

# ----------------------------------------
# Entry Point
# ----------------------------------------
main "$@"
