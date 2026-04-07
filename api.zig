// api.zig — Yuyutermux full server (31 endpoints)
// Build: zig build-exe api.zig -lc
// Run:   ./api

const std = @import("std");

// ============================================================
// Config
// ============================================================
const PROJECT_DIR     = "/data/data/com.termux/files/home/Yuyutermux";
const HOME_DIR        = "/data/data/com.termux/files/home";
const MAX_FILE_SIZE:   usize = 1  * 1024 * 1024;
const MAX_UPLOAD_SIZE: usize = 50 * 1024 * 1024;
const INIT_BUF:        usize = 65536;
const PORT: u16 = 5000;
const AUTH_TOKEN_ENV = "YUYUTERMUX_TOKEN";

var gpa = std.heap.GeneralPurposeAllocator(.{}){};
const allocator = gpa.allocator();

// ============================================================
// Global state
// ============================================================
var proc_map:     std.AutoHashMap(u32, std.posix.pid_t) = undefined;
var proc_counter: u32 = 0;
var proc_mutex:   std.Thread.Mutex = .{};

var g_cwd:     [std.fs.max_path_bytes]u8 = undefined;
var g_cwd_len: usize = 0;
var cwd_mutex: std.Thread.Mutex = .{};

fn getCwd() []const u8 {
    cwd_mutex.lock(); defer cwd_mutex.unlock();
    return if (g_cwd_len > 0) g_cwd[0..g_cwd_len] else PROJECT_DIR;
}
fn setCwd(path: []const u8) void {
    cwd_mutex.lock(); defer cwd_mutex.unlock();
    const n = @min(path.len, g_cwd.len - 1);
    @memcpy(g_cwd[0..n], path[0..n]);
    g_cwd_len = n;
}

// ============================================================
// Utilities
// ============================================================
fn eq(a: []const u8, b: []const u8) bool { return std.mem.eql(u8, a, b); }

fn statusText(code: u16) []const u8 {
    return switch (code) {
        200 => "OK", 400 => "Bad Request", 401 => "Unauthorized",
        403 => "Forbidden", 404 => "Not Found", 409 => "Conflict",
        413 => "Payload Too Large", 500 => "Internal Server Error",
        else => "Error",
    };
}

fn jsonEscape(b: *std.ArrayList(u8), s: []const u8) !void {
    for (s) |c| switch (c) {
        '"'  => try b.appendSlice(allocator, "\\\""),
        '\\' => try b.appendSlice(allocator, "\\\\"),
        '\n' => try b.appendSlice(allocator, "\\n"),
        '\r' => try b.appendSlice(allocator, "\\r"),
        '\t' => try b.appendSlice(allocator, "\\t"),
        0x00...0x08, 0x0B, 0x0C, 0x0E...0x1F =>
            try b.writer(allocator).print("\\u00{x:0>2}", .{c}),
        else => try b.append(allocator, c),
    };
}

fn urlDecode(enc: []const u8) ![]u8 {
    var out = try allocator.alloc(u8, enc.len);
    var di: usize = 0; var si: usize = 0;
    while (si < enc.len) {
        if (enc[si] == '%' and si + 2 < enc.len) {
            out[di] = std.fmt.parseInt(u8, enc[si+1..si+3], 16) catch '?';
            si += 3;
        } else { out[di] = if (enc[si] == '+') ' ' else enc[si]; si += 1; }
        di += 1;
    }
    return out[0..di];
}

fn qparam(q: []const u8, key: []const u8) ?[]const u8 {
    var it = std.mem.tokenizeAny(u8, q, "&");
    while (it.next()) |pair| {
        var kv = std.mem.tokenizeScalar(u8, pair, '=');
        const k = kv.next() orelse continue;
        if (!eq(k, key)) continue;
        return kv.next() orelse "";
    }
    return null;
}

fn getHeader(hdrs: []const u8, name: []const u8) ?[]const u8 {
    var it = std.mem.tokenizeSequence(u8, hdrs, "\r\n");
    while (it.next()) |line| {
        if (line.len <= name.len) continue;
        if (!std.ascii.startsWithIgnoreCase(line, name)) continue;
        if (line[name.len] != ':') continue;
        return std.mem.trim(u8, line[name.len+1..], " \t");
    }
    return null;
}

fn validatePath(p: []const u8) !?[]const u8 {
    if (p.len == 0) return try allocator.dupe(u8, PROJECT_DIR);
    if (std.mem.indexOf(u8, p, "..") != null) return null;
    const joined = try std.fs.path.join(allocator, &.{ PROJECT_DIR, p });
    defer allocator.free(joined);
    var buf: [std.fs.max_path_bytes]u8 = undefined;
    const resolved = std.fs.realpath(joined, &buf) catch return null;
    if (!std.mem.startsWith(u8, resolved, PROJECT_DIR)) return null;
    return try allocator.dupe(u8, resolved);
}

fn getAuthToken() ?[]u8 {
    return std.process.getEnvVarOwned(allocator, AUTH_TOKEN_ENV) catch null;
}
fn checkAuth(hdrs: []const u8, cookies: []const u8) bool {
    const tok = getAuthToken() orelse return true;
    defer allocator.free(tok);
    if (getHeader(hdrs, "Authorization")) |auth| {
        if (std.ascii.startsWithIgnoreCase(auth, "Bearer ") and
            eq(auth["Bearer ".len..], tok)) return true;
    }
    if (std.mem.indexOf(u8, cookies, "yuyu_token=")) |pos| {
        const s = pos + "yuyu_token=".len; var e = s;
        while (e < cookies.len and cookies[e] != ';') e += 1;
        if (eq(cookies[s..e], tok)) return true;
    }
    return false;
}

// ============================================================
// HTTP write helpers (all CRLF)
// ============================================================
fn writeRaw(c: std.net.Stream, status: u16, ct: []const u8,
            extra: []const u8, body: []const u8) !void {
    const head = try std.fmt.allocPrint(allocator,
        "HTTP/1.1 {d} {s}\r\nContent-Type: {s}\r\nContent-Length: {d}\r\n{s}\r\n",
        .{ status, statusText(status), ct, body.len, extra });
    defer allocator.free(head);
    try c.writeAll(head);
    try c.writeAll(body);
}
fn sendOkJson(c: std.net.Stream, json: []const u8) !void {
    try writeRaw(c, 200, "application/json", "", json);
}
fn sendJson(c: std.net.Stream, status: u16, json: []const u8) !void {
    try writeRaw(c, status, "application/json", "", json);
}
fn sendError(c: std.net.Stream, status: u16, msg: []const u8) !void {
    var b = std.ArrayList(u8).empty; defer b.deinit(allocator);
    try b.appendSlice(allocator, "{\"success\":false,\"error\":\"");
    try jsonEscape(&b, msg);
    try b.appendSlice(allocator, "\"}");
    try sendJson(c, status, b.items);
}
fn sendText(c: std.net.Stream, status: u16, text: []const u8) !void {
    try writeRaw(c, status, "text/plain; charset=utf-8", "", text);
}

// ============================================================
// Request parsing
// ============================================================
const Req = struct {
    method: []const u8, path: []const u8, query: []const u8,
    hdrs: []const u8, cookies: []const u8, body: []const u8,
    _buf: []u8, _extra: ?[]u8,
    fn deinit(self: *Req) void {
        allocator.free(self._buf);
        if (self._extra) |e| allocator.free(e);
    }
};

fn readReq(stream: std.net.Stream) !Req {
    var buf = try allocator.alloc(u8, INIT_BUF);
    errdefer allocator.free(buf);
    var total: usize = 0;
    while (total < buf.len) {
        const n = stream.read(buf[total..]) catch break;
        if (n == 0) break;
        total += n;
        if (std.mem.indexOf(u8, buf[0..total], "\r\n\r\n") != null) break;
    }
    if (total == 0) return error.EmptyRequest;
    const data = buf[0..total];
    const he = std.mem.indexOf(u8, data, "\r\n\r\n") orelse return error.BadRequest;
    const hdrs = data[0..he];
    const bs = he + 4;
    var cl: usize = 0;
    if (getHeader(hdrs, "Content-Length")) |v|
        cl = std.fmt.parseInt(usize, v, 10) catch 0;
    if (cl > MAX_UPLOAD_SIZE) return error.TooLarge;
    var body = data[@min(bs, data.len)..];
    var extra: ?[]u8 = null;
    if (cl > 0 and body.len < cl) {
        const fb = try allocator.alloc(u8, cl);
        @memcpy(fb[0..body.len], body);
        var got = body.len;
        while (got < cl) {
            const n = stream.read(fb[got..]) catch break;
            if (n == 0) break;
            got += n;
        }
        extra = fb; body = fb[0..got];
    }
    const le = std.mem.indexOf(u8, hdrs, "\r\n") orelse hdrs.len;
    var tok = std.mem.tokenizeScalar(u8, hdrs[0..le], ' ');
    const method  = tok.next() orelse "GET";
    const rawpath = tok.next() orelse "/";
    var path  = rawpath;
    var query: []const u8 = "";
    if (std.mem.indexOf(u8, rawpath, "?")) |qi| {
        path = rawpath[0..qi]; query = rawpath[qi+1..];
    }
    return .{
        .method = method, .path = path, .query = query,
        .hdrs = hdrs, .cookies = getHeader(hdrs, "Cookie") orelse "",
        .body = body, ._buf = buf, ._extra = extra,
    };
}

// ============================================================
// Static file server
// ============================================================
fn mimeType(ext: []const u8) []const u8 {
    if (eq(ext,".html")) return "text/html; charset=utf-8";
    if (eq(ext,".css"))  return "text/css";
    if (eq(ext,".js"))   return "application/javascript";
    if (eq(ext,".json")) return "application/json";
    if (eq(ext,".png"))  return "image/png";
    if (eq(ext,".jpg") or eq(ext,".jpeg")) return "image/jpeg";
    if (eq(ext,".gif"))  return "image/gif";
    if (eq(ext,".svg"))  return "image/svg+xml";
    if (eq(ext,".ico"))  return "image/x-icon";
    if (eq(ext,".woff2")) return "font/woff2";
    if (eq(ext,".woff")) return "font/woff";
    if (eq(ext,".ttf"))  return "font/ttf";
    return "application/octet-stream";
}
fn serveStatic(c: std.net.Stream, url_path: []const u8) !void {
    if (std.mem.indexOf(u8, url_path, "..") != null) { try sendError(c, 403, "Forbidden"); return; }
    const rel  = if (url_path.len > 0 and url_path[0] == '/') url_path[1..] else url_path;
    const disk = try std.fs.path.join(allocator, &.{ PROJECT_DIR, rel });
    defer allocator.free(disk);
    var buf: [std.fs.max_path_bytes]u8 = undefined;
    const resolved = std.fs.realpath(disk, &buf) catch { try sendError(c, 404, "Not found"); return; };
    if (!std.mem.startsWith(u8, resolved, PROJECT_DIR)) { try sendError(c, 403, "Forbidden"); return; }
    var file = std.fs.openFileAbsolute(resolved, .{}) catch { try sendError(c, 404, "Not found"); return; };
    defer file.close();
    const st = try file.stat();
    if (st.size > 10*1024*1024) { try sendError(c, 413, "Too large"); return; }
    const content = try file.readToEndAlloc(allocator, st.size+1);
    defer allocator.free(content);
    try writeRaw(c, 200, mimeType(std.fs.path.extension(resolved)), "", content);
}
fn serveTemplate(c: std.net.Stream, name: []const u8) !void {
    const path = try std.fs.path.join(allocator, &.{ PROJECT_DIR, "templates", name });
    defer allocator.free(path);
    var file = std.fs.openFileAbsolute(path, .{}) catch { try sendError(c, 404, "Template not found"); return; };
    defer file.close();
    const st = try file.stat();
    const content = try file.readToEndAlloc(allocator, st.size+1);
    defer allocator.free(content);
    try writeRaw(c, 200, "text/html; charset=utf-8", "", content);
}

// ============================================================
// 1–14: Core API handlers
// ============================================================
fn handleHealth(c: std.net.Stream) !void {
    try sendOkJson(c, "{\"success\":true,\"status\":\"ok\",\"service\":\"yuyutermux\"}");
}

fn handleFilesList(c: std.net.Stream, query: []const u8) !void {
    const raw = qparam(query, "path") orelse "";
    const dec = try urlDecode(raw); defer allocator.free(dec);
    const target = try validatePath(dec) orelse { try sendError(c, 403, "Invalid path"); return; };
    defer allocator.free(target);
    var dir = std.fs.openDirAbsolute(target, .{ .iterate = true }) catch |err| {
        try sendError(c, if (err == error.FileNotFound) 404 else 500, "Cannot open directory"); return;
    };
    defer dir.close();
    const E = struct { name: []u8, is_dir: bool, size: u64, mtime: i128 };
    var items = std.ArrayList(E).empty;
    defer { for (items.items) |i| allocator.free(i.name); items.deinit(allocator); }
    var it = dir.iterate();
    while (try it.next()) |ent| {
        const f = dir.openFile(ent.name, .{}) catch continue;
        defer f.close();
        const st = f.stat() catch continue;
        try items.append(allocator, .{ .name = try allocator.dupe(u8, ent.name),
            .is_dir = st.kind == .directory, .size = st.size, .mtime = st.mtime });
    }
    std.mem.sort(E, items.items, {}, struct {
        fn lt(_: void, a: E, b: E) bool {
            if (a.is_dir != b.is_dir) return a.is_dir;
            return std.mem.lessThan(u8, a.name, b.name);
        }
    }.lt);
    const disp = if (eq(target, PROJECT_DIR))
        try allocator.dupe(u8, "~/Yuyutermux")
    else
        try std.fmt.allocPrint(allocator, "~/Yuyutermux/{s}", .{target[PROJECT_DIR.len+1..]});
    defer allocator.free(disp);
    var b = std.ArrayList(u8).empty; defer b.deinit(allocator);
    try b.appendSlice(allocator, "{\"success\":true,\"current_path\":\"");
    try jsonEscape(&b, disp);
    try b.appendSlice(allocator, "\",\"items\":[");
    for (items.items, 0..) |item, idx| {
        if (idx > 0) try b.append(allocator, ',');
        try b.appendSlice(allocator, "{\"name\":\""); try jsonEscape(&b, item.name);
        try b.appendSlice(allocator, "\",\"type\":\"");
        try b.appendSlice(allocator, if (item.is_dir) "directory" else "file");
        try b.appendSlice(allocator, "\",\"size\":\"");
        if (item.is_dir) { try b.appendSlice(allocator, "-"); }
        else if (item.size < 1024) { try b.writer(allocator).print("{d} B", .{item.size}); }
        else if (item.size < 1024*1024) { try b.writer(allocator).print("{d:.1}K", .{@as(f64,@floatFromInt(item.size))/1024.0}); }
        else { try b.writer(allocator).print("{d:.1}M", .{@as(f64,@floatFromInt(item.size))/(1024.0*1024.0)}); }
        try b.appendSlice(allocator, "\",\"modified\":\"");
        try b.writer(allocator).print("{d}", .{@divFloor(item.mtime, 1_000_000_000)});
        try b.appendSlice(allocator, "\"}");
    }
    try b.appendSlice(allocator, "]}");
    try sendOkJson(c, b.items);
}

fn handleFilesRead(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { path: []const u8 }, allocator, body, .{}) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const fp = try validatePath(parsed.value.path) orelse { try sendError(c, 403, "Invalid path"); return; };
    defer allocator.free(fp);
    const file = std.fs.openFileAbsolute(fp, .{}) catch { try sendError(c, 404, "File not found"); return; };
    defer file.close();
    const st = file.stat() catch { try sendError(c, 500, "Stat failed"); return; };
    if (st.size > MAX_FILE_SIZE) { try sendError(c, 413, "File too large (>1MB)"); return; }
    const content = file.readToEndAlloc(allocator, MAX_FILE_SIZE) catch { try sendError(c, 500, "Read failed"); return; };
    defer allocator.free(content);
    var b = std.ArrayList(u8).empty; defer b.deinit(allocator);
    try b.appendSlice(allocator, "{\"success\":true,\"path\":\"");
    try jsonEscape(&b, if (eq(fp, PROJECT_DIR)) "" else fp[PROJECT_DIR.len+1..]);
    try b.appendSlice(allocator, "\",\"content\":\"");
    try jsonEscape(&b, content);
    try b.appendSlice(allocator, "\"}");
    try sendOkJson(c, b.items);
}

fn handleFilesWrite(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(
        struct { path: []const u8, content: []const u8 }, allocator, body, .{}) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const fp = try validatePath(parsed.value.path) orelse { try sendError(c, 403, "Invalid path"); return; };
    defer allocator.free(fp);
    if (parsed.value.content.len > 5*1024*1024) { try sendError(c, 413, "Content too large"); return; }
    const blocked = [_][]const u8{ ".auth_token", ".env", ".bashrc", ".bash_profile" };
    for (blocked) |bl| { if (eq(std.fs.path.basename(fp), bl)) { try sendError(c, 403, "Protected file"); return; } }
    std.fs.cwd().makePath(std.fs.path.dirname(fp) orelse ".") catch {};
    std.fs.cwd().writeFile(.{ .sub_path = fp, .data = parsed.value.content }) catch {
        try sendError(c, 500, "Write failed"); return;
    };
    try sendOkJson(c, "{\"success\":true,\"message\":\"File saved\"}");
}

fn handleFilesDelete(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { path: []const u8 }, allocator, body, .{}) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const fp = try validatePath(parsed.value.path) orelse { try sendError(c, 403, "Invalid path"); return; };
    defer allocator.free(fp);
    const protected = [_][]const u8{ "app.py", "utils.py", "run.sh" };
    const fname   = std.fs.path.basename(fp);
    const in_root = if (std.fs.path.dirname(fp)) |d| eq(d, PROJECT_DIR) else false;
    for (protected) |p| { if (in_root and eq(fname, p)) { try sendError(c, 403, "Cannot delete protected file"); return; } }
    std.fs.cwd().deleteFile(fp) catch {
        std.fs.cwd().deleteDir(fp) catch { try sendError(c, 500, "Delete failed"); return; };
    };
    try sendOkJson(c, "{\"success\":true,\"message\":\"Deleted\"}");
}

fn handleFilesCreate(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(
        struct { filename: []const u8, path: []const u8 }, allocator, body, .{}) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const dir_path = try validatePath(parsed.value.path) orelse { try sendError(c, 403, "Invalid path"); return; };
    defer allocator.free(dir_path);
    const fname = std.fs.path.basename(parsed.value.filename);
    if (fname.len == 0 or fname[0] == '.') { try sendError(c, 400, "Invalid filename"); return; }
    const full = try std.fs.path.join(allocator, &.{ dir_path, fname }); defer allocator.free(full);
    if (!std.mem.startsWith(u8, full, PROJECT_DIR)) { try sendError(c, 403, "Outside project"); return; }
    _ = std.fs.cwd().createFile(full, .{}) catch |err| {
        if (err == error.PathAlreadyExists) try sendError(c, 409, "File already exists")
        else try sendError(c, 500, "Create failed");
        return;
    };
    try sendOkJson(c, "{\"success\":true,\"message\":\"Created\"}");
}

fn handleFilesUpload(c: std.net.Stream, body: []const u8, content_type: []const u8) !void {
    const bm   = "boundary=";
    const bpos = std.mem.indexOf(u8, content_type, bm) orelse { try sendError(c, 400, "Invalid multipart content-type"); return; };
    var bend = bpos + bm.len;
    while (bend < content_type.len and content_type[bend] != ';' and content_type[bend] != ' ') bend += 1;
    const boundary = content_type[bpos + bm.len .. bend];
    const fb = try std.fmt.allocPrint(allocator, "--{s}", .{boundary}); defer allocator.free(fb);

    var path_value: []const u8 = "";
    var filename:   []const u8 = "";
    var file_data:  []const u8 = "";

    var remaining = body;
    if (std.mem.indexOf(u8, remaining, fb)) |first| {
        remaining = remaining[first + fb.len..];
        while (std.mem.indexOf(u8, remaining, fb)) |next_pos| {
            const part = remaining[0..next_pos];
            remaining  = remaining[next_pos + fb.len..];
            const pt = if (std.mem.startsWith(u8, part, "\r\n")) part[2..] else part;
            const split = std.mem.indexOf(u8, pt, "\r\n\r\n") orelse continue;
            const ph = pt[0..split];
            var   pb = pt[split + 4..];
            if (std.mem.endsWith(u8, pb, "\r\n")) pb = pb[0..pb.len - 2];
            const cd = getHeader(ph, "Content-Disposition") orelse continue;
            if (std.mem.indexOf(u8, cd, "name=\"path\"") != null) {
                path_value = pb;
            } else if (std.mem.indexOf(u8, cd, "name=\"file\"") != null) {
                if (std.mem.indexOf(u8, cd, "filename=\"")) |fi| {
                    const fstart = fi + "filename=\"".len;
                    var   fend   = fstart;
                    while (fend < cd.len and cd[fend] != '"') fend += 1;
                    filename = cd[fstart..fend];
                }
                file_data = pb;
            }
        }
    }
    if (path_value.len == 0 or file_data.len == 0 or filename.len == 0) {
        try sendError(c, 400, "Missing path, filename, or file data"); return;
    }
    const target_dir = try validatePath(path_value) orelse { try sendError(c, 403, "Invalid path"); return; };
    defer allocator.free(target_dir);
    const safe_fname = std.fs.path.basename(filename);
    if (safe_fname.len == 0 or safe_fname[0] == '.') { try sendError(c, 400, "Invalid filename"); return; }

    // unique name if collision
    var final_name = try allocator.dupe(u8, safe_fname);
    const check_path = try std.fs.path.join(allocator, &.{ target_dir, safe_fname });
    defer allocator.free(check_path);
    if (std.fs.accessAbsolute(check_path, .{}) catch null != null) {
        allocator.free(final_name);
        final_name = undefined;
        const ext  = std.fs.path.extension(safe_fname);
        const stem = safe_fname[0..safe_fname.len - ext.len];
        var counter: u32 = 1;
        while (true) : (counter += 1) {
            const cname = try std.fmt.allocPrint(allocator, "{s}_{d}{s}", .{stem, counter, ext});
            const cpath = try std.fs.path.join(allocator, &.{target_dir, cname});
            defer allocator.free(cpath);
            if (std.fs.accessAbsolute(cpath, .{}) catch null == null) {
                final_name = cname; break;
            }
            allocator.free(cname);
        }
    }
    defer allocator.free(final_name);

    const final_path = try std.fs.path.join(allocator, &.{ target_dir, final_name });
    defer allocator.free(final_path);
    std.fs.cwd().writeFile(.{ .sub_path = final_path, .data = file_data }) catch {
        try sendError(c, 500, "Failed to save file"); return;
    };
    const rel = if (final_path.len > PROJECT_DIR.len + 1) final_path[PROJECT_DIR.len+1..] else final_name;
    var b = std.ArrayList(u8).empty; defer b.deinit(allocator);
    try b.appendSlice(allocator, "{\"success\":true,\"message\":\"Uploaded: ");
    try jsonEscape(&b, safe_fname);
    try b.appendSlice(allocator, "\",\"path\":\""); try jsonEscape(&b, rel); try b.appendSlice(allocator, "\"}");
    try sendOkJson(c, b.items);
}

fn handleFilesDownload(c: std.net.Stream, query: []const u8) !void {
    const raw = qparam(query, "path") orelse "";
    const dec = try urlDecode(raw); defer allocator.free(dec);
    const fp = try validatePath(dec) orelse { try sendError(c, 403, "Invalid path"); return; };
    defer allocator.free(fp);
    var file = std.fs.openFileAbsolute(fp, .{}) catch { try sendError(c, 404, "File not found"); return; };
    defer file.close();
    const st = try file.stat();
    if (st.size > 100*1024*1024) { try sendError(c, 413, "File too large (>100MB)"); return; }
    const content = try file.readToEndAlloc(allocator, @intCast(st.size + 1));
    defer allocator.free(content);
    const fname = std.fs.path.basename(fp);
    const head = try std.fmt.allocPrint(allocator,
        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n" ++
        "Content-Disposition: attachment; filename=\"{s}\"\r\n" ++
        "Content-Length: {d}\r\n\r\n", .{ fname, content.len });
    defer allocator.free(head);
    try c.writeAll(head);
    try c.writeAll(content); // binary-safe
}

fn handleFilesSearch(c: std.net.Stream, query: []const u8) !void {
    const raw_q  = qparam(query, "q")      orelse "";
    const raw_f  = qparam(query, "folder") orelse "";
    const case_s = eq(qparam(query, "case") orelse "0", "1");
    const search_q = try urlDecode(raw_q); defer allocator.free(search_q);
    if (search_q.len == 0 or search_q.len > 200) { try sendError(c, 400, "Invalid query"); return; }
    const folder_dec = try urlDecode(raw_f); defer allocator.free(folder_dec);
    const folder = try validatePath(folder_dec) orelse { try sendError(c, 403, "Invalid folder"); return; };
    defer allocator.free(folder);
    var args = std.ArrayList([]const u8).empty; defer args.deinit(allocator);
    try args.appendSlice(allocator, &.{
        "grep", "-rn", "-F",
        "--include=*.py",  "--include=*.js",  "--include=*.ts",
        "--include=*.html","--include=*.css", "--include=*.json",
        "--include=*.md",  "--include=*.txt", "--include=*.sh",
        "--include=*.zig",
        "--exclude-dir=__pycache__", "--exclude-dir=.git", "--exclude-dir=node_modules",
    });
    if (!case_s) try args.append(allocator, "-i");
    try args.appendSlice(allocator, &.{ "--", search_q, folder });
    const res = std.process.Child.run(.{
        .allocator = allocator, .argv = args.items, .max_output_bytes = 5*1024*1024,
    }) catch { try sendOkJson(c, "{\"success\":true,\"results\":[]}"); return; };
    defer allocator.free(res.stdout); defer allocator.free(res.stderr);
    var b = std.ArrayList(u8).empty; defer b.deinit(allocator);
    try b.appendSlice(allocator, "{\"success\":true,\"results\":[");
    var lines = std.mem.tokenizeScalar(u8, res.stdout, '\n');
    var first = true; var count: usize = 0;
    while (lines.next()) |line| {
        if (count >= 100) break;
        const c1 = std.mem.indexOf(u8, line, ":") orelse continue;
        const rest = line[c1+1..];
        const c2 = std.mem.indexOf(u8, rest, ":") orelse continue;
        if (!first) try b.append(allocator, ','); first = false;
        try b.appendSlice(allocator, "{\"file\":\""); try jsonEscape(&b, line[0..c1]);
        try b.appendSlice(allocator, "\",\"matches\":[{\"line\":");
        try b.appendSlice(allocator, rest[0..c2]);
        try b.appendSlice(allocator, ",\"text\":\""); try jsonEscape(&b, rest[c2+1..]);
        try b.appendSlice(allocator, "\"}]}");
        count += 1;
    }
    try b.appendSlice(allocator, "]}");
    try sendOkJson(c, b.items);
}

fn handleProjectInfo(c: std.net.Stream) !void {
    var files: u32 = 0; var dirs: u32 = 0;
    var wdir = std.fs.openDirAbsolute(PROJECT_DIR, .{ .iterate = true }) catch {
        try sendError(c, 500, "Cannot open project"); return;
    };
    defer wdir.close();
    var walker = try wdir.walk(allocator); defer walker.deinit();
    while (try walker.next()) |ent| { if (ent.kind == .directory) dirs += 1 else files += 1; }
    const tree = std.process.Child.run(.{
        .allocator = allocator,
        .argv = &.{ "tree", "--charset=ascii", "--dirsfirst", "-I", "__pycache__|*.pyc" },
        .cwd = PROJECT_DIR,
    }) catch null;
    var b = std.ArrayList(u8).empty; defer b.deinit(allocator);
    try b.appendSlice(allocator, "{\"success\":true,\"tree\":\"");
    if (tree) |t| { defer allocator.free(t.stdout); defer allocator.free(t.stderr); try jsonEscape(&b, t.stdout); }
    else { try b.appendSlice(allocator, "tree not available"); }
    try b.writer(allocator).print("\",\"files\":{d},\"folders\":{d}}}", .{files, dirs});
    try sendOkJson(c, b.items);
}

fn handleTerminalCwd(c: std.net.Stream) !void {
    const cwd = getCwd();
    var b = std.ArrayList(u8).empty; defer b.deinit(allocator);
    try b.appendSlice(allocator, "{\"success\":true,\"cwd\":\""); try jsonEscape(&b, cwd);
    try b.appendSlice(allocator, "\",\"display\":\"");
    if (std.mem.startsWith(u8, cwd, HOME_DIR)) {
        try b.append(allocator, '~'); try jsonEscape(&b, cwd[HOME_DIR.len..]);
    } else { try jsonEscape(&b, cwd); }
    try b.appendSlice(allocator, "\"}");
    try sendOkJson(c, b.items);
}

fn tryUpdateCwd(cmd: []const u8, exec_cwd: []const u8) void {
    const t = std.mem.trim(u8, cmd, " \t");
    if (!std.mem.startsWith(u8, t, "cd")) return;
    if (t.len > 2 and t[2] != ' ' and t[2] != '\t') return;
    const pwd_cmd = std.fmt.allocPrint(allocator, "{s} && pwd", .{t}) catch return;
    defer allocator.free(pwd_cmd);
    const r = std.process.Child.run(.{
        .allocator = allocator, .argv = &.{ "sh", "-c", pwd_cmd },
        .cwd = exec_cwd, .max_output_bytes = 4096,
    }) catch return;
    defer allocator.free(r.stdout); defer allocator.free(r.stderr);
    if (r.term == .Exited and r.term.Exited == 0 and r.stdout.len > 0)
        setCwd(std.mem.trim(u8, r.stdout, " \n\r\t"));
}

fn handleTerminalStream(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { command: []const u8 }, allocator, body, .{}) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const cmd = std.mem.trim(u8, parsed.value.command, " \t\r\n");
    if (cmd.len == 0 or cmd.len > 10000) { try sendError(c, 400, "Invalid command"); return; }
    const blocked = [_][]const u8{ "mkfs", "dd", "shutdown", "reboot" };
    for (blocked) |bl| {
        if (eq(cmd, bl) or (std.mem.startsWith(u8, cmd, bl) and cmd.len > bl.len and
            (cmd[bl.len] == ' ' or cmd[bl.len] == '\t'))) {
            try sendError(c, 403, "Command blocked"); return;
        }
    }
    const exec_cwd = getCwd();
    var child = std.process.Child.init(&.{ "sh", "-c", cmd }, allocator);
    child.cwd = exec_cwd;
    child.stdout_behavior = .Pipe;
    child.stderr_behavior = .Pipe;
    child.spawn() catch |err| {
        var eb = std.ArrayList(u8).empty; defer eb.deinit(allocator);
        try eb.writer(allocator).print("spawn error: {}\n[EXIT_CODE:1]\n", .{err});
        try sendText(c, 200, eb.items); return;
    };
    const pid = child.id;
    const pid_key = blk: {
        proc_mutex.lock(); defer proc_mutex.unlock();
        proc_counter += 1; proc_map.put(proc_counter, pid) catch {};
        break :blk proc_counter;
    };
    defer { proc_mutex.lock(); _ = proc_map.remove(pid_key); proc_mutex.unlock(); }
    var out_buf = std.ArrayList(u8).empty; defer out_buf.deinit(allocator);
    var err_buf = std.ArrayList(u8).empty; defer err_buf.deinit(allocator);
    child.collectOutput(allocator, &out_buf, &err_buf, 10*1024*1024) catch {};
    const exit_code: u8 = blk: {
        const term = child.wait() catch break :blk 1;
        break :blk switch (term) { .Exited => |code| code, else => 1 };
    };
    tryUpdateCwd(cmd, exec_cwd);
    var b = std.ArrayList(u8).empty; defer b.deinit(allocator);
    try b.appendSlice(allocator, out_buf.items);
    if (err_buf.items.len > 0) try b.appendSlice(allocator, err_buf.items);
    try b.writer(allocator).print("\n[EXIT_CODE:{d}]\n", .{exit_code});
    try sendText(c, 200, b.items);
}

fn handleTerminalKill(c: std.net.Stream) !void {
    var pids = std.ArrayList(std.posix.pid_t).empty; defer pids.deinit(allocator);
    { proc_mutex.lock(); defer proc_mutex.unlock();
      var pit = proc_map.iterator();
      while (pit.next()) |entry| pids.append(allocator, entry.value_ptr.*) catch {};
      proc_map.clearRetainingCapacity(); }
    var killed: usize = 0;
    for (pids.items) |pid| { std.posix.kill(pid, std.posix.SIG.TERM) catch {}; killed += 1; }
    const msg = try std.fmt.allocPrint(allocator, "{{\"success\":true,\"message\":\"Killed {d} process(es)\"}}", .{killed});
    defer allocator.free(msg);
    try sendOkJson(c, msg);
}

fn handleAuthLogin(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { token: []const u8 }, allocator, body, .{}) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const tok_env = getAuthToken(); defer if (tok_env) |t| allocator.free(t);
    if (tok_env != null and !eq(parsed.value.token, tok_env.?)) {
        try sendError(c, 401, "Authentication failed"); return;
    }
    const bj = "{\"success\":true,\"redirect\":\"/\"}";
    const resp = try std.fmt.allocPrint(allocator,
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n" ++
        "Set-Cookie: yuyu_token={s}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000\r\n" ++
        "Set-Cookie: yuyu_authed=1; Path=/; Max-Age=2592000\r\n" ++
        "Content-Length: {d}\r\n\r\n{s}", .{ parsed.value.token, bj.len, bj });
    defer allocator.free(resp);
    try c.writeAll(resp);
}

fn handleAuthLogout(c: std.net.Stream) !void {
    const bj = "{\"success\":true,\"redirect\":\"/login\"}";
    const resp = try std.fmt.allocPrint(allocator,
        "HTTP/1.1 200 OK\r\n" ++
        "Set-Cookie: yuyu_token=; Path=/; Max-Age=0\r\n" ++
        "Set-Cookie: yuyu_authed=; Path=/; Max-Age=0\r\n" ++
        "Content-Type: application/json\r\n" ++
        "Content-Length: {d}\r\n\r\n{s}", .{ bj.len, bj });
    defer allocator.free(resp);
    try c.writeAll(resp);
}

fn handleVerifyToken(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { token: []const u8 }, allocator, body, .{}) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const tok_env = getAuthToken(); defer if (tok_env) |t| allocator.free(t);
    const valid = tok_env == null or eq(parsed.value.token, tok_env.?);
    try sendOkJson(c, if (valid) "{\"valid\":true}" else "{\"valid\":false}");
}

fn handleDocs(c: std.net.Stream) !void {
    try sendOkJson(c,
        \\{"success":true,"endpoints":[
        \\{"path":"/api/health","methods":["GET"]},
        \\{"path":"/api/files/list","methods":["GET"]},
        \\{"path":"/api/files/read","methods":["POST"]},
        \\{"path":"/api/files/write","methods":["POST"]},
        \\{"path":"/api/files/delete","methods":["POST"]},
        \\{"path":"/api/files/create","methods":["POST"]},
        \\{"path":"/api/files/upload","methods":["POST"]},
        \\{"path":"/api/files/download","methods":["GET"]},
        \\{"path":"/api/files/search","methods":["GET"]},
        \\{"path":"/api/project/info","methods":["GET"]},
        \\{"path":"/api/execute/cwd","methods":["GET"]},
        \\{"path":"/api/execute/stream","methods":["POST"]},
        \\{"path":"/api/execute/kill","methods":["POST"]},
        \\{"path":"/api/auth/login","methods":["POST"]},
        \\{"path":"/api/auth/logout","methods":["POST"]},
        \\{"path":"/api/verify-token","methods":["POST"]},
        \\{"path":"/api/git/status","methods":["GET"]},
        \\{"path":"/api/git/log","methods":["GET"]},
        \\{"path":"/api/git/branches","methods":["GET"]},
        \\{"path":"/api/git/diff","methods":["GET"]},
        \\{"path":"/api/git/config","methods":["GET","POST"]},
        \\{"path":"/api/git/init","methods":["POST"]},
        \\{"path":"/api/git/add","methods":["POST"]},
        \\{"path":"/api/git/unstage","methods":["POST"]},
        \\{"path":"/api/git/discard","methods":["POST"]},
        \\{"path":"/api/git/commit","methods":["POST"]},
        \\{"path":"/api/git/push","methods":["POST"]},
        \\{"path":"/api/git/pull","methods":["POST"]},
        \\{"path":"/api/git/fetch","methods":["POST"]},
        \\{"path":"/api/git/checkout","methods":["POST"]},
        \\{"path":"/api/git/remote","methods":["POST"]}
        \\],"total":31}
    );
}

// ============================================================
// Git helpers
// ============================================================
const GitResult = struct { ok: bool, stdout: []u8, stderr: []u8 };
fn gitRun(args: []const []const u8, cwd: []const u8) !GitResult {
    const res = std.process.Child.run(.{
        .allocator = allocator, .argv = args, .cwd = cwd, .max_output_bytes = 10*1024*1024,
    }) catch |err| {
        const msg = try std.fmt.allocPrint(allocator, "git error: {}", .{err});
        return .{ .ok = false, .stdout = try allocator.dupe(u8, ""), .stderr = msg };
    };
    return .{ .ok = (res.term == .Exited and res.term.Exited == 0), .stdout = res.stdout, .stderr = res.stderr };
}
fn gitFree(r: GitResult) void { allocator.free(r.stdout); allocator.free(r.stderr); }

fn handleGitStatus(c: std.net.Stream) !void {
    const chk = try gitRun(&.{ "git", "rev-parse", "--git-dir" }, PROJECT_DIR); gitFree(chk);
    if (!chk.ok) { try sendOkJson(c, "{\"success\":true,\"is_repo\":false}"); return; }
    const br = try gitRun(&.{ "git", "branch", "--show-current" }, PROJECT_DIR); defer gitFree(br);
    var branch_alloc: ?[]u8 = null; defer if (branch_alloc) |ba| allocator.free(ba);
    var branch: []const u8 = "unknown";
    if (br.ok and br.stdout.len > 0) { branch = std.mem.trim(u8, br.stdout, " \n\r"); }
    else {
        const hr = try gitRun(&.{ "git", "rev-parse", "--short", "HEAD" }, PROJECT_DIR); defer gitFree(hr);
        if (hr.ok) { branch_alloc = try std.fmt.allocPrint(allocator, "detached@{s}", .{std.mem.trim(u8, hr.stdout, " \n\r")}); branch = branch_alloc.?; }
    }
    const sr = try gitRun(&.{ "git", "status", "--porcelain" }, PROJECT_DIR); defer gitFree(sr);
    var staged   = std.ArrayList(u8).empty; defer staged.deinit(allocator);
    var unstaged = std.ArrayList(u8).empty; defer unstaged.deinit(allocator);
    var untrack  = std.ArrayList(u8).empty; defer untrack.deinit(allocator);
    if (sr.ok) {
        var lines = std.mem.tokenizeScalar(u8, sr.stdout, '\n');
        while (lines.next()) |line| {
            if (line.len < 4) continue;
            const x = line[0]; const y = line[1]; const fname = line[3..];
            if (x == '?' and y == '?') { try untrack.appendSlice(allocator, ",\""); try jsonEscape(&untrack, fname); try untrack.append(allocator, '"'); }
            else {
                if (x != ' ' and x != '?') { try staged.writer(allocator).print(",{{\"status\":\"{c}\",\"file\":\"", .{x}); try jsonEscape(&staged, fname); try staged.appendSlice(allocator, "\"}"); }
                if (y != ' ' and y != '?') { try unstaged.writer(allocator).print(",{{\"status\":\"{c}\",\"file\":\"", .{y}); try jsonEscape(&unstaged, fname); try unstaged.appendSlice(allocator, "\"}"); }
            }
        }
    }
    const rr = try gitRun(&.{ "git", "remote", "-v" }, PROJECT_DIR); defer gitFree(rr);
    var remotes = std.ArrayList(u8).empty; defer remotes.deinit(allocator);
    if (rr.ok) {
        var lines = std.mem.tokenizeScalar(u8, rr.stdout, '\n');
        var seen  = std.StringHashMap(void).init(allocator); defer seen.deinit();
        while (lines.next()) |line| {
            var parts = std.mem.tokenizeAny(u8, line, " \t");
            const name = parts.next() orelse continue; const url = parts.next() orelse continue;
            if (seen.contains(name)) continue; try seen.put(name, {});
            try remotes.appendSlice(allocator, ",{\"name\":\""); try jsonEscape(&remotes, name);
            try remotes.appendSlice(allocator, "\",\"url\":\"");  try jsonEscape(&remotes, url);
            try remotes.appendSlice(allocator, "\"}");
        }
    }
    var ahead: u32 = 0; var behind: u32 = 0;
    const ab = try gitRun(&.{ "git", "rev-list", "--left-right", "--count", "HEAD...@{u}" }, PROJECT_DIR); defer gitFree(ab);
    if (ab.ok) {
        var p = std.mem.tokenizeAny(u8, ab.stdout, " \t\n");
        if (p.next()) |a| ahead  = std.fmt.parseInt(u32, a, 10) catch 0;
        if (p.next()) |b| behind = std.fmt.parseInt(u32, b, 10) catch 0;
    }
    var out = std.ArrayList(u8).empty; defer out.deinit(allocator);
    try out.appendSlice(allocator, "{\"success\":true,\"is_repo\":true,\"branch\":\""); try jsonEscape(&out, branch);
    try out.appendSlice(allocator, "\",\"staged\":[");   try out.appendSlice(allocator, if (staged.items.len   > 0) staged.items[1..]   else "");
    try out.appendSlice(allocator, "],\"unstaged\":[");  try out.appendSlice(allocator, if (unstaged.items.len > 0) unstaged.items[1..] else "");
    try out.appendSlice(allocator, "],\"untracked\":["); try out.appendSlice(allocator, if (untrack.items.len  > 0) untrack.items[1..]  else "");
    try out.appendSlice(allocator, "],\"remotes\":[");   try out.appendSlice(allocator, if (remotes.items.len  > 0) remotes.items[1..]  else "");
    try out.writer(allocator).print("],\"ahead\":{d},\"behind\":{d}}}", .{ahead, behind});
    try sendOkJson(c, out.items);
}

fn handleGitLog(c: std.net.Stream, query: []const u8) !void {
    var limit: u32 = 15;
    if (qparam(query, "limit")) |lv| limit = @min(std.fmt.parseInt(u32, lv, 10) catch 15, 50);
    const lstr = try std.fmt.allocPrint(allocator, "--max-count={d}", .{limit}); defer allocator.free(lstr);
    const r = try gitRun(&.{ "git", "log", lstr, "--pretty=format:%H|%h|%s|%an|%ar" }, PROJECT_DIR); defer gitFree(r);
    if (!r.ok) { try sendError(c, 500, "Git log failed"); return; }
    var b = std.ArrayList(u8).empty; defer b.deinit(allocator);
    try b.appendSlice(allocator, "{\"success\":true,\"commits\":[");
    var lines = std.mem.tokenizeScalar(u8, r.stdout, '\n'); var first = true;
    while (lines.next()) |line| {
        var parts = std.mem.tokenizeScalar(u8, line, '|');
        const hash = parts.next() orelse continue; const short = parts.next() orelse "";
        const msg  = parts.next() orelse "";       const author = parts.next() orelse "";
        const time = parts.next() orelse "";
        if (!first) try b.append(allocator, ','); first = false;
        try b.appendSlice(allocator, "{\"hash\":\"");    try jsonEscape(&b, hash);
        try b.appendSlice(allocator, "\",\"short\":\""); try jsonEscape(&b, short);
        try b.appendSlice(allocator, "\",\"message\":\""); try jsonEscape(&b, msg);
        try b.appendSlice(allocator, "\",\"author\":\""); try jsonEscape(&b, author);
        try b.appendSlice(allocator, "\",\"time\":\"");   try jsonEscape(&b, time);
        try b.appendSlice(allocator, "\"}");
    }
    try b.appendSlice(allocator, "]}"); try sendOkJson(c, b.items);
}

fn handleGitBranches(c: std.net.Stream) !void {
    const r = try gitRun(&.{ "git", "branch", "-a" }, PROJECT_DIR); defer gitFree(r);
    if (!r.ok) { try sendError(c, 500, "Git branches failed"); return; }
    var b = std.ArrayList(u8).empty; defer b.deinit(allocator);
    try b.appendSlice(allocator, "{\"success\":true,\"branches\":[");
    var lines = std.mem.tokenizeScalar(u8, r.stdout, '\n'); var first = true;
    while (lines.next()) |line| {
        if (std.mem.indexOf(u8, line, "HEAD ->") != null or line.len == 0) continue;
        const is_cur = line[0] == '*';
        const name = std.mem.trim(u8, if (is_cur) line[1..] else line, " ");
        if (name.len == 0) continue;
        if (!first) try b.append(allocator, ','); first = false;
        try b.appendSlice(allocator, "{\"name\":\""); try jsonEscape(&b, name);
        try b.appendSlice(allocator, "\",\"current\":"); try b.appendSlice(allocator, if (is_cur) "true" else "false"); try b.append(allocator, '}');
    }
    try b.appendSlice(allocator, "]}"); try sendOkJson(c, b.items);
}

fn handleGitInit(c: std.net.Stream) !void {
    const r = try gitRun(&.{ "git", "init" }, PROJECT_DIR); defer gitFree(r);
    if (r.ok) try sendOkJson(c, "{\"success\":true,\"message\":\"Repository initialized\"}") else try sendError(c, 500, r.stderr);
}

fn handleGitAdd(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { files: []const []const u8 }, allocator, body, .{}) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    var args = std.ArrayList([]const u8).empty; defer args.deinit(allocator);
    try args.appendSlice(allocator, &.{ "git", "add", "--" });
    for (parsed.value.files) |f| try args.append(allocator, f);
    const r = try gitRun(args.items, PROJECT_DIR); defer gitFree(r);
    if (r.ok) try sendOkJson(c, "{\"success\":true,\"message\":\"Staged\"}") else try sendError(c, 500, r.stderr);
}

fn handleGitUnstage(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { file: []const u8 }, allocator, body, .{}) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const r = try gitRun(&.{ "git", "restore", "--staged", "--", parsed.value.file }, PROJECT_DIR); defer gitFree(r);
    if (r.ok) try sendOkJson(c, "{\"success\":true,\"message\":\"Unstaged\"}") else try sendError(c, 500, r.stderr);
}

fn handleGitDiscard(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { file: []const u8 }, allocator, body, .{}) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const r = try gitRun(&.{ "git", "restore", "--", parsed.value.file }, PROJECT_DIR); defer gitFree(r);
    if (r.ok) try sendOkJson(c, "{\"success\":true,\"message\":\"Discarded\"}") else try sendError(c, 500, r.stderr);
}

fn handleGitCommit(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { message: []const u8 }, allocator, body, .{}) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    if (parsed.value.message.len == 0 or parsed.value.message.len > 5000) { try sendError(c, 400, "Invalid commit message"); return; }
    const r = try gitRun(&.{ "git", "commit", "-m", parsed.value.message }, PROJECT_DIR); defer gitFree(r);
    if (r.ok) try sendOkJson(c, "{\"success\":true,\"message\":\"Committed\"}") else try sendError(c, 500, r.stderr);
}

fn handleGitPush(c: std.net.Stream, body: []const u8) !void {
    const P = struct { remote: []const u8, branch: []const u8, force: bool, set_upstream: bool };
    const parsed = std.json.parseFromSlice(P, allocator, body, .{ .ignore_unknown_fields = true }) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    var args = std.ArrayList([]const u8).empty; defer args.deinit(allocator);
    try args.appendSlice(allocator, &.{ "git", "push" });
    if (parsed.value.force)        try args.append(allocator, "--force");
    if (parsed.value.set_upstream) try args.append(allocator, "-u");
    try args.append(allocator, parsed.value.remote);
    try args.append(allocator, if (parsed.value.branch.len > 0) parsed.value.branch else "HEAD");
    const r = try gitRun(args.items, PROJECT_DIR); defer gitFree(r);
    if (r.ok) try sendOkJson(c, "{\"success\":true,\"message\":\"Push successful\"}") else try sendError(c, 500, r.stderr);
}

fn handleGitPull(c: std.net.Stream, body: []const u8) !void {
    const P = struct { remote: []const u8, branch: []const u8 };
    const parsed = std.json.parseFromSlice(P, allocator, body, .{ .ignore_unknown_fields = true }) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    var args = std.ArrayList([]const u8).empty; defer args.deinit(allocator);
    try args.appendSlice(allocator, &.{ "git", "pull" });
    try args.append(allocator, parsed.value.remote);
    if (parsed.value.branch.len > 0) try args.append(allocator, parsed.value.branch);
    const r = try gitRun(args.items, PROJECT_DIR); defer gitFree(r);
    if (r.ok) try sendOkJson(c, "{\"success\":true,\"message\":\"Pull successful\"}") else try sendError(c, 500, r.stderr);
}

fn handleGitFetch(c: std.net.Stream) !void {
    const r = try gitRun(&.{ "git", "fetch", "--all" }, PROJECT_DIR); defer gitFree(r);
    if (r.ok) try sendOkJson(c, "{\"success\":true,\"message\":\"Fetch complete\"}") else try sendError(c, 500, r.stderr);
}

fn handleGitCheckout(c: std.net.Stream, body: []const u8) !void {
    const P = struct { branch: []const u8, create: bool };
    const parsed = std.json.parseFromSlice(P, allocator, body, .{ .ignore_unknown_fields = true }) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    var args = std.ArrayList([]const u8).empty; defer args.deinit(allocator);
    try args.appendSlice(allocator, &.{ "git", "checkout" });
    if (parsed.value.create) try args.append(allocator, "-b");
    try args.append(allocator, parsed.value.branch);
    const r = try gitRun(args.items, PROJECT_DIR); defer gitFree(r);
    if (r.ok) try sendOkJson(c, "{\"success\":true,\"message\":\"Checked out\"}") else try sendError(c, 500, r.stderr);
}

fn handleGitRemote(c: std.net.Stream, body: []const u8) !void {
    const P = struct { action: []const u8, name: []const u8, url: []const u8 };
    const parsed = std.json.parseFromSlice(P, allocator, body, .{ .ignore_unknown_fields = true }) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    if (eq(parsed.value.action, "add")) {
        var r = try gitRun(&.{ "git", "remote", "add", parsed.value.name, parsed.value.url }, PROJECT_DIR);
        if (!r.ok and std.mem.indexOf(u8, r.stderr, "already exists") != null) {
            gitFree(r); r = try gitRun(&.{ "git", "remote", "set-url", parsed.value.name, parsed.value.url }, PROJECT_DIR);
        }
        defer gitFree(r);
        if (r.ok) try sendOkJson(c, "{\"success\":true,\"message\":\"Remote updated\"}") else try sendError(c, 500, r.stderr);
    } else if (eq(parsed.value.action, "remove")) {
        const r = try gitRun(&.{ "git", "remote", "remove", parsed.value.name }, PROJECT_DIR); defer gitFree(r);
        if (r.ok) try sendOkJson(c, "{\"success\":true,\"message\":\"Remote removed\"}") else try sendError(c, 500, r.stderr);
    } else { try sendError(c, 400, "Unknown action (use add or remove)"); }
}

fn handleGitConfigGet(c: std.net.Stream) !void {
    const nr = try gitRun(&.{ "git", "config", "--global", "user.name"  }, PROJECT_DIR); defer gitFree(nr);
    const er = try gitRun(&.{ "git", "config", "--global", "user.email" }, PROJECT_DIR); defer gitFree(er);
    var b = std.ArrayList(u8).empty; defer b.deinit(allocator);
    try b.appendSlice(allocator, "{\"success\":true,\"name\":\"");
    try jsonEscape(&b, if (nr.ok) std.mem.trim(u8, nr.stdout, " \n\r") else "");
    try b.appendSlice(allocator, "\",\"email\":\"");
    try jsonEscape(&b, if (er.ok) std.mem.trim(u8, er.stdout, " \n\r") else "");
    try b.appendSlice(allocator, "\"}");
    try sendOkJson(c, b.items);
}

fn handleGitConfigPost(c: std.net.Stream, body: []const u8) !void {
    const P = struct { name: []const u8, email: []const u8 };
    const parsed = std.json.parseFromSlice(P, allocator, body, .{ .ignore_unknown_fields = true }) catch {
        try sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    if (parsed.value.name.len > 0) {
        const r = try gitRun(&.{ "git", "config", "--global", "user.name", parsed.value.name }, PROJECT_DIR); defer gitFree(r);
        if (!r.ok) { try sendError(c, 500, r.stderr); return; }
    }
    if (parsed.value.email.len > 0) {
        const r = try gitRun(&.{ "git", "config", "--global", "user.email", parsed.value.email }, PROJECT_DIR); defer gitFree(r);
        if (!r.ok) { try sendError(c, 500, r.stderr); return; }
    }
    try sendOkJson(c, "{\"success\":true,\"message\":\"Config updated\"}");
}

fn handleGitDiff(c: std.net.Stream, query: []const u8) !void {
    const file_p = qparam(query, "file")   orelse "";
    const staged = eq(qparam(query, "staged") orelse "0", "1");
    var args = std.ArrayList([]const u8).empty; defer args.deinit(allocator);
    try args.appendSlice(allocator, &.{ "git", "diff" });
    if (staged) try args.append(allocator, "--staged");
    if (file_p.len > 0) { try args.append(allocator, "--"); try args.append(allocator, file_p); }
    const r = try gitRun(args.items, PROJECT_DIR); defer gitFree(r);
    var b = std.ArrayList(u8).empty; defer b.deinit(allocator);
    try b.appendSlice(allocator, "{\"success\":true,\"diff\":\"");
    if (r.ok) try jsonEscape(&b, r.stdout);
    try b.appendSlice(allocator, "\"}");
    try sendOkJson(c, b.items);
}

// ============================================================
// Connection handler (1 thread per connection = concurrent)
// ============================================================
const ConnArgs = struct { stream: std.net.Stream };

fn handleConn(args_ptr: *ConnArgs) void {
    defer allocator.destroy(args_ptr);
    const stream = args_ptr.stream;
    defer stream.close();

    var req = readReq(stream) catch return;
    defer req.deinit();

    const m = req.method;
    const p = req.path;
    const q = req.query;
    const b = req.body;

    // ── Static & pages (public) ──
    if (eq(m,"GET") and std.mem.startsWith(u8, p, "/static/")) {
        serveStatic(stream, p) catch {}; return;
    }
    if (eq(m,"GET") and (eq(p,"/") or eq(p,"/index.html"))) {
        serveTemplate(stream, "index.html") catch {}; return;
    }
    if (eq(m,"GET") and eq(p,"/login")) {
        serveTemplate(stream, "login.html") catch {}; return;
    }
    if (eq(m,"GET") and eq(p,"/docs")) {
        serveTemplate(stream, "docs.html") catch {}; return;
    }

    // ── Auth check ──
    const is_public =
        eq(p,"/api/health")       or eq(p,"/api/auth/login") or
        eq(p,"/api/verify-token") or eq(p,"/api/docs/endpoints");
    if (!is_public and !checkAuth(req.hdrs, req.cookies)) {
        sendError(stream, 401, "Unauthorized") catch {}; return;
    }

    // ── Router ──
    if      (eq(m,"GET")  and eq(p,"/api/health"))             handleHealth(stream)                catch {}
    else if (eq(m,"GET")  and eq(p,"/api/files/list"))          handleFilesList(stream, q)          catch {}
    else if (eq(m,"POST") and eq(p,"/api/files/read"))          handleFilesRead(stream, b)          catch {}
    else if (eq(m,"POST") and eq(p,"/api/files/write"))         handleFilesWrite(stream, b)         catch {}
    else if (eq(m,"POST") and eq(p,"/api/files/delete"))        handleFilesDelete(stream, b)        catch {}
    else if (eq(m,"POST") and eq(p,"/api/files/create"))        handleFilesCreate(stream, b)        catch {}
    else if (eq(m,"POST") and eq(p,"/api/files/upload"))        {
        const ct = getHeader(req.hdrs, "Content-Type") orelse "";
        handleFilesUpload(stream, b, ct) catch {};
    }
    else if (eq(m,"GET")  and eq(p,"/api/files/download"))      handleFilesDownload(stream, q)      catch {}
    else if (eq(m,"GET")  and eq(p,"/api/files/search"))        handleFilesSearch(stream, q)        catch {}
    else if (eq(m,"GET")  and eq(p,"/api/project/info"))        handleProjectInfo(stream)           catch {}
    else if (eq(m,"GET")  and eq(p,"/api/execute/cwd"))         handleTerminalCwd(stream)           catch {}
    else if (eq(m,"POST") and eq(p,"/api/execute/stream"))      handleTerminalStream(stream, b)     catch {}
    else if (eq(m,"POST") and eq(p,"/api/execute/kill"))        handleTerminalKill(stream)          catch {}
    else if (eq(m,"POST") and eq(p,"/api/auth/login"))          handleAuthLogin(stream, b)          catch {}
    else if (eq(m,"POST") and eq(p,"/api/auth/logout"))         handleAuthLogout(stream)            catch {}
    else if (eq(m,"POST") and eq(p,"/api/verify-token"))        handleVerifyToken(stream, b)        catch {}
    else if (eq(m,"GET")  and eq(p,"/api/docs/endpoints"))      handleDocs(stream)                  catch {}
    else if (eq(m,"GET")  and eq(p,"/api/git/status"))          handleGitStatus(stream)             catch {}
    else if (eq(m,"GET")  and eq(p,"/api/git/log"))             handleGitLog(stream, q)             catch {}
    else if (eq(m,"GET")  and eq(p,"/api/git/branches"))        handleGitBranches(stream)           catch {}
    else if (eq(m,"GET")  and eq(p,"/api/git/diff"))            handleGitDiff(stream, q)            catch {}
    else if (eq(m,"GET")  and eq(p,"/api/git/config"))          handleGitConfigGet(stream)          catch {}
    else if (eq(m,"POST") and eq(p,"/api/git/config"))          handleGitConfigPost(stream, b)      catch {}
    else if (eq(m,"POST") and eq(p,"/api/git/init"))            handleGitInit(stream)               catch {}
    else if (eq(m,"POST") and eq(p,"/api/git/add"))             handleGitAdd(stream, b)             catch {}
    else if (eq(m,"POST") and eq(p,"/api/git/unstage"))         handleGitUnstage(stream, b)         catch {}
    else if (eq(m,"POST") and eq(p,"/api/git/discard"))         handleGitDiscard(stream, b)         catch {}
    else if (eq(m,"POST") and eq(p,"/api/git/commit"))          handleGitCommit(stream, b)          catch {}
    else if (eq(m,"POST") and eq(p,"/api/git/push"))            handleGitPush(stream, b)            catch {}
    else if (eq(m,"POST") and eq(p,"/api/git/pull"))            handleGitPull(stream, b)            catch {}
    else if (eq(m,"POST") and eq(p,"/api/git/fetch"))           handleGitFetch(stream)              catch {}
    else if (eq(m,"POST") and eq(p,"/api/git/checkout"))        handleGitCheckout(stream, b)        catch {}
    else if (eq(m,"POST") and eq(p,"/api/git/remote"))          handleGitRemote(stream, b)          catch {}
    else sendError(stream, 404, "Not found") catch {};
}

// ============================================================
// main
// ============================================================
pub fn main() !void {
    defer _ = gpa.deinit();
    proc_map = std.AutoHashMap(u32, std.posix.pid_t).init(allocator);
    defer proc_map.deinit();

    const addr = try std.net.Address.parseIp4("0.0.0.0", PORT);
    var server  = try addr.listen(.{ .reuse_address = true });
    defer server.deinit();

    std.log.info("🚀 Yuyutermux Zig server on http://0.0.0.0:{d} (31 endpoints)", .{PORT});

    while (true) {
        const conn = server.accept() catch |err| {
            std.log.err("accept error: {}", .{err}); continue;
        };
        const args = allocator.create(ConnArgs) catch { conn.stream.close(); continue; };
        args.* = .{ .stream = conn.stream };
        const thread = std.Thread.spawn(.{}, handleConn, .{args}) catch |err| {
            std.log.err("spawn error: {}", .{err});
            allocator.destroy(args); conn.stream.close(); continue;
        };
        thread.detach();
    }
}
