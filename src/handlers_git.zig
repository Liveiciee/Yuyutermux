const std = @import("std");
const config = @import("config");
const utils = @import("utils");
const http = @import("http");

const GitResult = struct { ok: bool, stdout: []u8, stderr: []u8 };

fn gitRun(args: []const []const u8, cwd: []const u8) !GitResult {
    const res = std.process.Child.run(.{
        .allocator = config.allocator, .argv = args, .cwd = cwd, .max_output_bytes = 10*1024*1024,
    }) catch |err| {
        const msg = try std.fmt.allocPrint(config.allocator, "git error: {}", .{err});
        return .{ .ok = false, .stdout = try config.allocator.dupe(u8, ""), .stderr = msg };
    };
    return .{ .ok = (res.term == .Exited and res.term.Exited == 0), .stdout = res.stdout, .stderr = res.stderr };
}

fn gitFree(r: GitResult) void { config.allocator.free(r.stdout); config.allocator.free(r.stderr); }

pub fn handleGitStatus(c: std.net.Stream) !void {
    const chk = try gitRun(&.{ "git", "rev-parse", "--git-dir" }, config.PROJECT_DIR); gitFree(chk);
    if (!chk.ok) { try http.sendOkJson(c, "{\"success\":true,\"is_repo\":false}"); return; }
    
    const br = try gitRun(&.{ "git", "branch", "--show-current" }, config.PROJECT_DIR); defer gitFree(br);
    var branch_alloc: ?[]u8 = null; defer if (branch_alloc) |ba| config.allocator.free(ba);
    var branch: []const u8 = "unknown";
    if (br.ok and br.stdout.len > 0) { branch = std.mem.trim(u8, br.stdout, " \n\r"); }
    else {
        const hr = try gitRun(&.{ "git", "rev-parse", "--short", "HEAD" }, config.PROJECT_DIR); defer gitFree(hr);
        if (hr.ok) { branch_alloc = try std.fmt.allocPrint(config.allocator, "detached@{s}", .{std.mem.trim(u8, hr.stdout, " \n\r")}); branch = branch_alloc.?; }
    }
    
    const sr = try gitRun(&.{ "git", "status", "--porcelain" }, config.PROJECT_DIR); defer gitFree(sr);
    var staged = std.ArrayList(u8).empty; defer staged.deinit(config.allocator);
    var unstaged = std.ArrayList(u8).empty; defer unstaged.deinit(config.allocator);
    var untrack = std.ArrayList(u8).empty; defer untrack.deinit(config.allocator);
    
    if (sr.ok) {
        var lines = std.mem.tokenizeScalar(u8, sr.stdout, '\n');
        while (lines.next()) |line| {
            if (line.len < 4) continue;
            const x = line[0]; const y = line[1]; const fname = line[3..];
            if (x == '?' and y == '?') { try untrack.appendSlice(config.allocator, ",\""); try utils.jsonEscape(&untrack, fname); try untrack.append(config.allocator, '"'); }
            else {
                if (x != ' ' and x != '?') { try staged.writer(config.allocator).print(",{{\"status\":\"{c}\",\"file\":\"", .{x}); try utils.jsonEscape(&staged, fname); try staged.appendSlice(config.allocator, "\"}"); }
                if (y != ' ' and y != '?') { try unstaged.writer(config.allocator).print(",{{\"status\":\"{c}\",\"file\":\"", .{y}); try utils.jsonEscape(&unstaged, fname); try unstaged.appendSlice(config.allocator, "\"}"); }
            }
        }
    }
    
    const rr = try gitRun(&.{ "git", "remote", "-v" }, config.PROJECT_DIR); defer gitFree(rr);
    var remotes = std.ArrayList(u8).empty; defer remotes.deinit(config.allocator);
    if (rr.ok) {
        var lines = std.mem.tokenizeScalar(u8, rr.stdout, '\n');
        var seen = std.StringHashMap(void).init(config.allocator); defer seen.deinit();
        while (lines.next()) |line| {
            var parts = std.mem.tokenizeAny(u8, line, " \t");
            const name = parts.next() orelse continue; const url = parts.next() orelse continue;
            if (seen.contains(name)) continue; try seen.put(name, {});
            try remotes.appendSlice(config.allocator, ",{\"name\":\""); try utils.jsonEscape(&remotes, name);
            try remotes.appendSlice(config.allocator, "\",\"url\":\"");  try utils.jsonEscape(&remotes, url);
            try remotes.appendSlice(config.allocator, "\"}");
        }
    }
    
    var ahead: u32 = 0; var behind: u32 = 0;
    const ab = try gitRun(&.{ "git", "rev-list", "--left-right", "--count", "HEAD...@{u}" }, config.PROJECT_DIR); defer gitFree(ab);
    if (ab.ok) {
        var p = std.mem.tokenizeAny(u8, ab.stdout, " \t\n");
        if (p.next()) |a| ahead = std.fmt.parseInt(u32, a, 10) catch 0;
        if (p.next()) |b| behind = std.fmt.parseInt(u32, b, 10) catch 0;
    }
    
    var out = std.ArrayList(u8).empty; defer out.deinit(config.allocator);
    try out.appendSlice(config.allocator, "{\"success\":true,\"is_repo\":true,\"branch\":\""); try utils.jsonEscape(&out, branch);
    try out.appendSlice(config.allocator, "\",\"staged\":[");   try out.appendSlice(config.allocator, if (staged.items.len > 0) staged.items[1..] else "");
    try out.appendSlice(config.allocator, "],\"unstaged\":[");  try out.appendSlice(config.allocator, if (unstaged.items.len > 0) unstaged.items[1..] else "");
    try out.appendSlice(config.allocator, "],\"untracked\":["); try out.appendSlice(config.allocator, if (untrack.items.len > 0) untrack.items[1..] else "");
    try out.appendSlice(config.allocator, "],\"remotes\":[");   try out.appendSlice(config.allocator, if (remotes.items.len > 0) remotes.items[1..] else "");
    try out.writer(config.allocator).print("],\"ahead\":{d},\"behind\":{d}}}", .{ahead, behind});
    try http.sendOkJson(c, out.items);
}

pub fn handleGitLog(c: std.net.Stream, query: []const u8) !void {
    var limit: u32 = 15;
    if (utils.qparam(query, "limit")) |lv| limit = @min(std.fmt.parseInt(u32, lv, 10) catch 15, 50);
    const lstr = try std.fmt.allocPrint(config.allocator, "--max-count={d}", .{limit}); defer config.allocator.free(lstr);
    const r = try gitRun(&.{ "git", "log", lstr, "--pretty=format:%H|%h|%s|%an|%ar" }, config.PROJECT_DIR); defer gitFree(r);
    if (!r.ok) { try http.sendError(c, 500, "Git log failed"); return; }
    var b = std.ArrayList(u8).empty; defer b.deinit(config.allocator);
    try b.appendSlice(config.allocator, "{\"success\":true,\"commits\":[");
    var lines = std.mem.tokenizeScalar(u8, r.stdout, '\n'); var first = true;
    while (lines.next()) |line| {
        var parts = std.mem.tokenizeScalar(u8, line, '|');
        const hash = parts.next() orelse continue; const short = parts.next() orelse "";
        const msg = parts.next() orelse ""; const author = parts.next() orelse "";
        const time = parts.next() orelse "";
        if (!first) try b.append(config.allocator, ','); first = false;
        try b.appendSlice(config.allocator, "{\"hash\":\"");    try utils.jsonEscape(&b, hash);
        try b.appendSlice(config.allocator, "\",\"short\":\""); try utils.jsonEscape(&b, short);
        try b.appendSlice(config.allocator, "\",\"message\":\""); try utils.jsonEscape(&b, msg);
        try b.appendSlice(config.allocator, "\",\"author\":\""); try utils.jsonEscape(&b, author);
        try b.appendSlice(config.allocator, "\",\"time\":\"");   try utils.jsonEscape(&b, time);
        try b.appendSlice(config.allocator, "\"}");
    }
    try b.appendSlice(config.allocator, "]}"); try http.sendOkJson(c, b.items);
}

pub fn handleGitBranches(c: std.net.Stream) !void {
    const r = try gitRun(&.{ "git", "branch", "-a" }, config.PROJECT_DIR); defer gitFree(r);
    if (!r.ok) { try http.sendError(c, 500, "Git branches failed"); return; }
    var b = std.ArrayList(u8).empty; defer b.deinit(config.allocator);
    try b.appendSlice(config.allocator, "{\"success\":true,\"branches\":[");
    var lines = std.mem.tokenizeScalar(u8, r.stdout, '\n'); var first = true;
    while (lines.next()) |line| {
        if (std.mem.indexOf(u8, line, "HEAD ->") != null or line.len == 0) continue;
        const is_cur = line[0] == '*';
        const name = std.mem.trim(u8, if (is_cur) line[1..] else line, " ");
        if (name.len == 0) continue;
        if (!first) try b.append(config.allocator, ','); first = false;
        try b.appendSlice(config.allocator, "{\"name\":\""); try utils.jsonEscape(&b, name);
        try b.appendSlice(config.allocator, "\",\"current\":"); try b.appendSlice(config.allocator, if (is_cur) "true" else "false"); try b.append(config.allocator, '}');
    }
    try b.appendSlice(config.allocator, "]}"); try http.sendOkJson(c, b.items);
}

pub fn handleGitInit(c: std.net.Stream) !void {
    const r = try gitRun(&.{ "git", "init" }, config.PROJECT_DIR); defer gitFree(r);
    if (r.ok) try http.sendOkJson(c, "{\"success\":true,\"message\":\"Repository initialized\"}") else try http.sendError(c, 500, r.stderr);
}

pub fn handleGitAdd(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { files: []const []const u8 }, config.allocator, body, .{}) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    var args = std.ArrayList([]const u8).empty; defer args.deinit(config.allocator);
    try args.appendSlice(config.allocator, &.{ "git", "add", "--" });
    for (parsed.value.files) |f| try args.append(config.allocator, f);
    const r = try gitRun(args.items, config.PROJECT_DIR); defer gitFree(r);
    if (r.ok) try http.sendOkJson(c, "{\"success\":true,\"message\":\"Staged\"}") else try http.sendError(c, 500, r.stderr);
}

pub fn handleGitUnstage(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { file: []const u8 }, config.allocator, body, .{}) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const r = try gitRun(&.{ "git", "restore", "--staged", "--", parsed.value.file }, config.PROJECT_DIR); defer gitFree(r);
    if (r.ok) try http.sendOkJson(c, "{\"success\":true,\"message\":\"Unstaged\"}") else try http.sendError(c, 500, r.stderr);
}

pub fn handleGitDiscard(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { file: []const u8 }, config.allocator, body, .{}) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const r = try gitRun(&.{ "git", "restore", "--", parsed.value.file }, config.PROJECT_DIR); defer gitFree(r);
    if (r.ok) try http.sendOkJson(c, "{\"success\":true,\"message\":\"Discarded\"}") else try http.sendError(c, 500, r.stderr);
}

pub fn handleGitCommit(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { message: []const u8 }, config.allocator, body, .{}) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    if (parsed.value.message.len == 0 or parsed.value.message.len > 5000) { try http.sendError(c, 400, "Invalid commit message"); return; }
    const r = try gitRun(&.{ "git", "commit", "-m", parsed.value.message }, config.PROJECT_DIR); defer gitFree(r);
    if (r.ok) try http.sendOkJson(c, "{\"success\":true,\"message\":\"Committed\"}") else try http.sendError(c, 500, r.stderr);
}

pub fn handleGitPush(c: std.net.Stream, body: []const u8) !void {
    const P = struct { remote: []const u8, branch: []const u8, force: bool, set_upstream: bool };
    const parsed = std.json.parseFromSlice(P, config.allocator, body, .{ .ignore_unknown_fields = true }) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    var args = std.ArrayList([]const u8).empty; defer args.deinit(config.allocator);
    try args.appendSlice(config.allocator, &.{ "git", "push" });
    if (parsed.value.force)        try args.append(config.allocator, "--force");
    if (parsed.value.set_upstream) try args.append(config.allocator, "-u");
    try args.append(config.allocator, parsed.value.remote);
    try args.append(config.allocator, if (parsed.value.branch.len > 0) parsed.value.branch else "HEAD");
    const r = try gitRun(args.items, config.PROJECT_DIR); defer gitFree(r);
    if (r.ok) try http.sendOkJson(c, "{\"success\":true,\"message\":\"Push successful\"}") else try http.sendError(c, 500, r.stderr);
}

pub fn handleGitPull(c: std.net.Stream, body: []const u8) !void {
    const P = struct { remote: []const u8, branch: []const u8 };
    const parsed = std.json.parseFromSlice(P, config.allocator, body, .{ .ignore_unknown_fields = true }) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    var args = std.ArrayList([]const u8).empty; defer args.deinit(config.allocator);
    try args.appendSlice(config.allocator, &.{ "git", "pull" });
    try args.append(config.allocator, parsed.value.remote);
    if (parsed.value.branch.len > 0) try args.append(config.allocator, parsed.value.branch);
    const r = try gitRun(args.items, config.PROJECT_DIR); defer gitFree(r);
    if (r.ok) try http.sendOkJson(c, "{\"success\":true,\"message\":\"Pull successful\"}") else try http.sendError(c, 500, r.stderr);
}

pub fn handleGitFetch(c: std.net.Stream) !void {
    const r = try gitRun(&.{ "git", "fetch", "--all" }, config.PROJECT_DIR); defer gitFree(r);
    if (r.ok) try http.sendOkJson(c, "{\"success\":true,\"message\":\"Fetch complete\"}") else try http.sendError(c, 500, r.stderr);
}

pub fn handleGitCheckout(c: std.net.Stream, body: []const u8) !void {
    const P = struct { branch: []const u8, create: bool };
    const parsed = std.json.parseFromSlice(P, config.allocator, body, .{ .ignore_unknown_fields = true }) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    var args = std.ArrayList([]const u8).empty; defer args.deinit(config.allocator);
    try args.appendSlice(config.allocator, &.{ "git", "checkout" });
    if (parsed.value.create) try args.append(config.allocator, "-b");
    try args.append(config.allocator, parsed.value.branch);
    const r = try gitRun(args.items, config.PROJECT_DIR); defer gitFree(r);
    if (r.ok) try http.sendOkJson(c, "{\"success\":true,\"message\":\"Checked out\"}") else try http.sendError(c, 500, r.stderr);
}

pub fn handleGitRemote(c: std.net.Stream, body: []const u8) !void {
    const P = struct { action: []const u8, name: []const u8, url: []const u8 };

    const parsed = std.json.parseFromSlice(P, config.allocator, body, .{ .ignore_unknown_fields = true }) catch {
        try http.sendError(c, 400, "Invalid JSON");
        return;
    };
    defer parsed.deinit();

    if (utils.eq(parsed.value.action, "add")) {
        var r = try gitRun(&.{ "git", "remote", "add", parsed.value.name, parsed.value.url }, config.PROJECT_DIR);
        defer gitFree(r);

        // kalau sudah ada → fallback ke set-url
        if (!r.ok and std.mem.indexOf(u8, r.stderr, "already exists") != null) {
            gitFree(r);
            r = try gitRun(&.{ "git", "remote", "set-url", parsed.value.name, parsed.value.url }, config.PROJECT_DIR);
            defer gitFree(r);
        }

        if (r.ok)
            try http.sendOkJson(c, "{\"success\":true,\"message\":\"Remote updated\"}")
        else
            try http.sendError(c, 500, r.stderr);

    } else if (utils.eq(parsed.value.action, "remove")) {

        const r = try gitRun(&.{ "git", "remote", "remove", parsed.value.name }, config.PROJECT_DIR);
        defer gitFree(r);

        if (r.ok)
            try http.sendOkJson(c, "{\"success\":true,\"message\":\"Remote removed\"}")
        else
            try http.sendError(c, 500, r.stderr);

    } else {
        try http.sendError(c, 400, "Unknown action (use add or remove)");
    }
}

pub fn handleGitConfigGet(c: std.net.Stream) !void {
    const nr = try gitRun(&.{ "git", "config", "--global", "user.name"  }, config.PROJECT_DIR); defer gitFree(nr);
    const er = try gitRun(&.{ "git", "config", "--global", "user.email" }, config.PROJECT_DIR); defer gitFree(er);
    var b = std.ArrayList(u8).empty; defer b.deinit(config.allocator);
    try b.appendSlice(config.allocator, "{\"success\":true,\"name\":\"");
    try utils.jsonEscape(&b, if (nr.ok) std.mem.trim(u8, nr.stdout, " \n\r") else "");
    try b.appendSlice(config.allocator, "\",\"email\":\"");
    try utils.jsonEscape(&b, if (er.ok) std.mem.trim(u8, er.stdout, " \n\r") else "");
    try b.appendSlice(config.allocator, "\"}");
    try http.sendOkJson(c, b.items);
}

pub fn handleGitConfigPost(c: std.net.Stream, body: []const u8) !void {
    const P = struct { name: []const u8, email: []const u8 };
    const parsed = std.json.parseFromSlice(P, config.allocator, body, .{ .ignore_unknown_fields = true }) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    if (parsed.value.name.len > 0) {
        const r = try gitRun(&.{ "git", "config", "--global", "user.name", parsed.value.name }, config.PROJECT_DIR); defer gitFree(r);
        if (!r.ok) { try http.sendError(c, 500, r.stderr); return; }
    }
    if (parsed.value.email.len > 0) {
        const r = try gitRun(&.{ "git", "config", "--global", "user.email", parsed.value.email }, config.PROJECT_DIR); defer gitFree(r);
        if (!r.ok) { try http.sendError(c, 500, r.stderr); return; }
    }
    try http.sendOkJson(c, "{\"success\":true,\"message\":\"Config updated\"}");
}

pub fn handleGitDiff(c: std.net.Stream, query: []const u8) !void {
    const file_p = utils.qparam(query, "file") orelse "";
    const staged = utils.eq(utils.qparam(query, "staged") orelse "0", "1");
    var args = std.ArrayList([]const u8).empty; defer args.deinit(config.allocator);
    try args.appendSlice(config.allocator, &.{ "git", "diff" });
    if (staged) try args.append(config.allocator, "--staged");
    if (file_p.len > 0) { try args.append(config.allocator, "--"); try args.append(config.allocator, file_p); }
    const r = try gitRun(args.items, config.PROJECT_DIR); defer gitFree(r);
    var b = std.ArrayList(u8).empty; defer b.deinit(config.allocator);
    try b.appendSlice(config.allocator, "{\"success\":true,\"diff\":\"");
    if (r.ok) try utils.jsonEscape(&b, r.stdout);
    try b.appendSlice(config.allocator, "\"}");
    try http.sendOkJson(c, b.items);
}
