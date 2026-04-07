const std = @import("std");
const config = @import("config");
const utils = @import("utils");
const http = @import("http");

pub fn handleFilesList(c: std.net.Stream, query: []const u8) !void {
    const raw = utils.qparam(query, "path") orelse "";
    const dec = try utils.urlDecode(raw); defer config.allocator.free(dec);
    const target = try utils.validatePath(dec) orelse { try http.sendError(c, 403, "Invalid path"); return; };
    defer config.allocator.free(target);
    var dir = std.fs.openDirAbsolute(target, .{ .iterate = true }) catch |err| {
        try http.sendError(c, if (err == error.FileNotFound) 404 else 500, "Cannot open directory"); return;
    };
    defer dir.close();
    const E = struct { name: []u8, is_dir: bool, size: u64, mtime: i128 };
    var items = std.ArrayList(E).empty;
    defer { for (items.items) |i| config.allocator.free(i.name); items.deinit(config.allocator); }
    var it = dir.iterate();
    while (try it.next()) |ent| {
        const f = dir.openFile(ent.name, .{}) catch continue;
        defer f.close();
        const st = f.stat() catch continue;
        try items.append(config.allocator, .{ .name = try config.allocator.dupe(u8, ent.name),
            .is_dir = st.kind == .directory, .size = st.size, .mtime = st.mtime });
    }
    std.mem.sort(E, items.items, {}, struct {
        fn lt(_: void, a: E, b: E) bool {
            if (a.is_dir != b.is_dir) return a.is_dir;
            return std.mem.lessThan(u8, a.name, b.name);
        }
    }.lt);
    const disp = if (utils.eq(target, config.PROJECT_DIR))
        try config.allocator.dupe(u8, "~/Yuyutermux")
    else
        try std.fmt.allocPrint(config.allocator, "~/Yuyutermux/{s}", .{target[config.PROJECT_DIR.len+1..]});
    defer config.allocator.free(disp);
    var b = std.ArrayList(u8).empty; defer b.deinit(config.allocator);
    try b.appendSlice(config.allocator, "{\"success\":true,\"current_path\":\"");
    try utils.jsonEscape(&b, disp);
    try b.appendSlice(config.allocator, "\",\"items\":[");
    for (items.items, 0..) |item, idx| {
        if (idx > 0) try b.append(config.allocator, ',');
        try b.appendSlice(config.allocator, "{\"name\":\""); try utils.jsonEscape(&b, item.name);
        try b.appendSlice(config.allocator, "\",\"type\":\"");
        try b.appendSlice(config.allocator, if (item.is_dir) "directory" else "file");
        try b.appendSlice(config.allocator, "\",\"size\":\"");
        if (item.is_dir) { try b.appendSlice(config.allocator, "-"); }
        else if (item.size < 1024) { try b.writer(config.allocator).print("{d} B", .{item.size}); }
        else if (item.size < 1024*1024) { try b.writer(config.allocator).print("{d:.1}K", .{@as(f64,@floatFromInt(item.size))/1024.0}); }
        else { try b.writer(config.allocator).print("{d:.1}M", .{@as(f64,@floatFromInt(item.size))/(1024.0*1024.0)}); }
        try b.appendSlice(config.allocator, "\",\"modified\":\"");
        try b.writer(config.allocator).print("{d}", .{@divFloor(item.mtime, 1_000_000_000)});
        try b.appendSlice(config.allocator, "\"}");
    }
    try b.appendSlice(config.allocator, "]}");
    try http.sendOkJson(c, b.items);
}

pub fn handleFilesRead(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { path: []const u8 }, config.allocator, body, .{}) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const fp = try utils.validatePath(parsed.value.path) orelse { try http.sendError(c, 403, "Invalid path"); return; };
    defer config.allocator.free(fp);
    const file = std.fs.openFileAbsolute(fp, .{}) catch { try http.sendError(c, 404, "File not found"); return; };
    defer file.close();
    const st = file.stat() catch { try http.sendError(c, 500, "Stat failed"); return; };
    if (st.size > config.MAX_FILE_SIZE) { try http.sendError(c, 413, "File too large (>1MB)"); return; }
    const content = file.readToEndAlloc(config.allocator, config.MAX_FILE_SIZE) catch { try http.sendError(c, 500, "Read failed"); return; };
    defer config.allocator.free(content);
    var b = std.ArrayList(u8).empty; defer b.deinit(config.allocator);
    try b.appendSlice(config.allocator, "{\"success\":true,\"path\":\"");
    try utils.jsonEscape(&b, if (utils.eq(fp, config.PROJECT_DIR)) "" else fp[config.PROJECT_DIR.len+1..]);
    try b.appendSlice(config.allocator, "\",\"content\":\"");
    try utils.jsonEscape(&b, content);
    try b.appendSlice(config.allocator, "\"}");
    try http.sendOkJson(c, b.items);
}

pub fn handleFilesWrite(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(
        struct { path: []const u8, content: []const u8 }, config.allocator, body, .{}) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const fp = try utils.validatePath(parsed.value.path) orelse { try http.sendError(c, 403, "Invalid path"); return; };
    defer config.allocator.free(fp);
    if (parsed.value.content.len > 5*1024*1024) { try http.sendError(c, 413, "Content too large"); return; }
    const blocked = [_][]const u8{ ".auth_token", ".env", ".bashrc", ".bash_profile" };
    for (blocked) |bl| { if (utils.eq(std.fs.path.basename(fp), bl)) { try http.sendError(c, 403, "Protected file"); return; } }
    std.fs.cwd().makePath(std.fs.path.dirname(fp) orelse ".") catch {};
    std.fs.cwd().writeFile(.{ .sub_path = fp, .data = parsed.value.content }) catch {
        try http.sendError(c, 500, "Write failed"); return;
    };
    try http.sendOkJson(c, "{\"success\":true,\"message\":\"File saved\"}");
}

pub fn handleFilesDelete(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { path: []const u8 }, config.allocator, body, .{}) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const fp = try utils.validatePath(parsed.value.path) orelse { try http.sendError(c, 403, "Invalid path"); return; };
    defer config.allocator.free(fp);
    const protected = [_][]const u8{ "app.py", "utils.py", "run.sh" };
    const fname = std.fs.path.basename(fp);
    const in_root = if (std.fs.path.dirname(fp)) |d| utils.eq(d, config.PROJECT_DIR) else false;
    for (protected) |p| { if (in_root and utils.eq(fname, p)) { try http.sendError(c, 403, "Cannot delete protected file"); return; } }
    std.fs.cwd().deleteFile(fp) catch {
        std.fs.cwd().deleteDir(fp) catch { try http.sendError(c, 500, "Delete failed"); return; };
    };
    try http.sendOkJson(c, "{\"success\":true,\"message\":\"Deleted\"}");
}

pub fn handleFilesCreate(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(
        struct { filename: []const u8, path: []const u8 }, config.allocator, body, .{}) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const dir_path = try utils.validatePath(parsed.value.path) orelse { try http.sendError(c, 403, "Invalid path"); return; };
    defer config.allocator.free(dir_path);
    const fname = std.fs.path.basename(parsed.value.filename);
    if (fname.len == 0 or fname[0] == '.') { try http.sendError(c, 400, "Invalid filename"); return; }
    const full = try std.fs.path.join(config.allocator, &.{ dir_path, fname }); defer config.allocator.free(full);
    if (!std.mem.startsWith(u8, full, config.PROJECT_DIR)) { try http.sendError(c, 403, "Outside project"); return; }
    _ = std.fs.cwd().createFile(full, .{}) catch |err| {
        if (err == error.PathAlreadyExists) try http.sendError(c, 409, "File already exists")
        else try http.sendError(c, 500, "Create failed");
        return;
    };
    try http.sendOkJson(c, "{\"success\":true,\"message\":\"Created\"}");
}

pub fn handleFilesUpload(c: std.net.Stream, body: []const u8, content_type: []const u8) !void {
    const bm = "boundary=";
    const bpos = std.mem.indexOf(u8, content_type, bm) orelse { try http.sendError(c, 400, "Invalid multipart content-type"); return; };
    var bend = bpos + bm.len;
    while (bend < content_type.len and content_type[bend] != ';' and content_type[bend] != ' ') bend += 1;
    const boundary = content_type[bpos + bm.len .. bend];
    const fb = try std.fmt.allocPrint(config.allocator, "--{s}", .{boundary}); defer config.allocator.free(fb);

    var path_value: []const u8 = "";
    var filename: []const u8 = "";
    var file_data: []const u8 = "";

    var remaining = body;
    if (std.mem.indexOf(u8, remaining, fb)) |first| {
        remaining = remaining[first + fb.len..];
        while (std.mem.indexOf(u8, remaining, fb)) |next_pos| {
            const part = remaining[0..next_pos];
            remaining = remaining[next_pos + fb.len..];
            const pt = if (std.mem.startsWith(u8, part, "\r\n")) part[2..] else part;
            const split = std.mem.indexOf(u8, pt, "\r\n\r\n") orelse continue;
            const ph = pt[0..split];
            var pb = pt[split + 4..];
            if (std.mem.endsWith(u8, pb, "\r\n")) pb = pb[0..pb.len - 2];
            const cd = utils.getHeader(ph, "Content-Disposition") orelse continue;
            if (std.mem.indexOf(u8, cd, "name=\"path\"") != null) {
                path_value = pb;
            } else if (std.mem.indexOf(u8, cd, "name=\"file\"") != null) {
                if (std.mem.indexOf(u8, cd, "filename=\"")) |fi| {
                    const fstart = fi + "filename=\"".len;
                    var fend = fstart;
                    while (fend < cd.len and cd[fend] != '"') fend += 1;
                    filename = cd[fstart..fend];
                }
                file_data = pb;
            }
        }
    }
    if (path_value.len == 0 or file_data.len == 0 or filename.len == 0) {
        try http.sendError(c, 400, "Missing path, filename, or file data"); return;
    }
    const target_dir = try utils.validatePath(path_value) orelse { try http.sendError(c, 403, "Invalid path"); return; };
    defer config.allocator.free(target_dir);
    const safe_fname = std.fs.path.basename(filename);
    if (safe_fname.len == 0 or safe_fname[0] == '.') { try http.sendError(c, 400, "Invalid filename"); return; }

    var final_name = try config.allocator.dupe(u8, safe_fname);
    const check_path = try std.fs.path.join(config.allocator, &.{ target_dir, safe_fname });
    defer config.allocator.free(check_path);
    if (std.fs.accessAbsolute(check_path, .{}) catch null != null) {
        config.allocator.free(final_name);
        final_name = undefined;
        const ext = std.fs.path.extension(safe_fname);
        const stem = safe_fname[0..safe_fname.len - ext.len];
        var counter: u32 = 1;
        while (true) : (counter += 1) {
            const cname = try std.fmt.allocPrint(config.allocator, "{s}_{d}{s}", .{stem, counter, ext});
            const cpath = try std.fs.path.join(config.allocator, &.{target_dir, cname});
            defer config.allocator.free(cpath);
            if (std.fs.accessAbsolute(cpath, .{}) catch null == null) {
                final_name = cname; break;
            }
            config.allocator.free(cname);
        }
    }
    defer config.allocator.free(final_name);

    const final_path = try std.fs.path.join(config.allocator, &.{ target_dir, final_name });
    defer config.allocator.free(final_path);
    std.fs.cwd().writeFile(.{ .sub_path = final_path, .data = file_data }) catch {
        try http.sendError(c, 500, "Failed to save file"); return;
    };
    const rel = if (final_path.len > config.PROJECT_DIR.len + 1) final_path[config.PROJECT_DIR.len+1..] else final_name;
    var b = std.ArrayList(u8).empty; defer b.deinit(config.allocator);
    try b.appendSlice(config.allocator, "{\"success\":true,\"message\":\"Uploaded: ");
    try utils.jsonEscape(&b, safe_fname);
    try b.appendSlice(config.allocator, "\",\"path\":\""); try utils.jsonEscape(&b, rel); try b.appendSlice(config.allocator, "\"}");
    try http.sendOkJson(c, b.items);
}

pub fn handleFilesDownload(c: std.net.Stream, query: []const u8) !void {
    const raw = utils.qparam(query, "path") orelse "";
    const dec = try utils.urlDecode(raw); defer config.allocator.free(dec);
    const fp = try utils.validatePath(dec) orelse { try http.sendError(c, 403, "Invalid path"); return; };
    defer config.allocator.free(fp);
    var file = std.fs.openFileAbsolute(fp, .{}) catch { try http.sendError(c, 404, "File not found"); return; };
    defer file.close();
    const st = try file.stat();
    if (st.size > 100*1024*1024) { try http.sendError(c, 413, "File too large (>100MB)"); return; }
    const content = try file.readToEndAlloc(config.allocator, @intCast(st.size + 1));
    defer config.allocator.free(content);
    const fname = std.fs.path.basename(fp);
    const head = try std.fmt.allocPrint(config.allocator,
        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n" ++
        "Content-Disposition: attachment; filename=\"{s}\"\r\n" ++
        "Content-Length: {d}\r\n\r\n", .{ fname, content.len });
    defer config.allocator.free(head);
    try c.writeAll(head);
    try c.writeAll(content);
}

pub fn handleFilesSearch(c: std.net.Stream, query: []const u8) !void {
    const raw_f = utils.qparam(query, "folder") orelse "";
    const raw_q = utils.qparam(query, "q") orelse "";
    const case_s = utils.eq(utils.qparam(query, "case") orelse "0", "1");

    const search_q = try utils.urlDecode(raw_q);
    defer config.allocator.free(search_q);

    if (search_q.len == 0 or search_q.len > 200) {
        try http.sendError(c, 400, "Invalid query");
        return;
    }

    const folder_dec = try utils.urlDecode(raw_f);
    defer config.allocator.free(folder_dec);

    const folder = try utils.validatePath(folder_dec) orelse {
        try http.sendError(c, 403, "Invalid folder");
        return;
    };
    defer config.allocator.free(folder);
    
    var args = std.ArrayList([]const u8).empty;
    defer args.deinit(config.allocator);

    try args.appendSlice(config.allocator, &.{
        "grep", "-rn", "-F",
        "--include=*.py",  "--include=*.js",  "--include=*.ts",
        "--include=*.html","--include=*.css", "--include=*.json",
        "--include=*.md",  "--include=*.txt", "--include=*.sh",
        "--include=*.zig",
        "--exclude-dir=__pycache__", "--exclude-dir=.git", "--exclude-dir=node_modules",
    });

    if (!case_s) try args.append(config.allocator, "-i");

    try args.appendSlice(config.allocator, &.{ "--", search_q, folder });
    
    const res = std.process.Child.run(.{
        .allocator = config.allocator,
        .argv = args.items,
        .max_output_bytes = 5*1024*1024,
    }) catch {
        try http.sendOkJson(c, "{\"success\":true,\"results\":[]}");
        return;
    };

    defer config.allocator.free(res.stdout);
    defer config.allocator.free(res.stderr);
    
    var b = std.ArrayList(u8).empty;
    defer b.deinit(config.allocator);

    try b.appendSlice(config.allocator, "{\"success\":true,\"results\":[");

    var lines = std.mem.tokenizeScalar(u8, res.stdout, '\n');
    var first = true;
    var count: usize = 0;

    while (lines.next()) |line| {
        if (count >= 100) break;

        const c1 = std.mem.indexOf(u8, line, ":") orelse continue;
        const rest = line[c1+1..];
        const c2 = std.mem.indexOf(u8, rest, ":") orelse continue;

        if (!first) try b.append(config.allocator, ',');
        first = false;

        try b.appendSlice(config.allocator, "{\"file\":\"");
        try utils.jsonEscape(&b, line[0..c1]);

        try b.appendSlice(config.allocator, "\",\"matches\":[{\"line\":");
        try b.appendSlice(config.allocator, rest[0..c2]);

        try b.appendSlice(config.allocator, ",\"text\":\"");
        try utils.jsonEscape(&b, rest[c2+1..]);

        try b.appendSlice(config.allocator, "\"}]}");

        count += 1;
    }

    try b.appendSlice(config.allocator, "]}");
    try http.sendOkJson(c, b.items);
}
