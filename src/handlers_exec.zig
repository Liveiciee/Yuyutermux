const std = @import("std");
const config = @import("config");
const utils = @import("utils");
const http = @import("http");

pub fn handleHealth(c: std.net.Stream) !void {
    try http.sendOkJson(c, "{\"success\":true,\"status\":\"ok\",\"service\":\"yuyutermux\"}");
}

pub fn handleProjectInfo(c: std.net.Stream) !void {
    var files: u32 = 0; var dirs: u32 = 0;
    var wdir = std.fs.openDirAbsolute(config.PROJECT_DIR, .{ .iterate = true }) catch {
        try http.sendError(c, 500, "Cannot open project"); return;
    };
    defer wdir.close();
    var walker = try wdir.walk(config.allocator); defer walker.deinit();
    while (try walker.next()) |ent| { if (ent.kind == .directory) dirs += 1 else files += 1; }
    
    const tree = std.process.Child.run(.{
        .allocator = config.allocator,
        .argv = &.{ "tree", "--charset=ascii", "--dirsfirst", "-I", "__pycache__|*.pyc" },
        .cwd = config.PROJECT_DIR,
    }) catch null;
    
    var b = std.ArrayList(u8).empty; defer b.deinit(config.allocator);
    try b.appendSlice(config.allocator, "{\"success\":true,\"tree\":\"");
    if (tree) |t| { 
        defer config.allocator.free(t.stdout); defer config.allocator.free(t.stderr); 
        try utils.jsonEscape(&b, t.stdout); 
    } else { 
        try b.appendSlice(config.allocator, "tree not available"); 
    }
    try b.writer(config.allocator).print("\",\"files\":{d},\"folders\":{d}}}", .{files, dirs});
    try http.sendOkJson(c, b.items);
}

pub fn handleTerminalCwd(c: std.net.Stream) !void {
    const cwd = config.getCwd();
    var b = std.ArrayList(u8).empty; defer b.deinit(config.allocator);
    try b.appendSlice(config.allocator, "{\"success\":true,\"cwd\":\""); try utils.jsonEscape(&b, cwd);
    try b.appendSlice(config.allocator, "\",\"display\":\"");
    if (std.mem.startsWith(u8, cwd, config.HOME_DIR)) {
        try b.append(config.allocator, '~'); try utils.jsonEscape(&b, cwd[config.HOME_DIR.len..]);
    } else { try utils.jsonEscape(&b, cwd); }
    try b.appendSlice(config.allocator, "\"}");
    try http.sendOkJson(c, b.items);
}

fn tryUpdateCwd(cmd: []const u8, exec_cwd: []const u8) void {
    const t = std.mem.trim(u8, cmd, " \t");
    if (!std.mem.startsWith(u8, t, "cd")) return;
    if (t.len > 2 and t[2] != ' ' and t[2] != '\t') return;
    const pwd_cmd = std.fmt.allocPrint(config.allocator, "{s} && pwd", .{t}) catch return;
    defer config.allocator.free(pwd_cmd);
    const r = std.process.Child.run(.{
        .allocator = config.allocator, .argv = &.{ "sh", "-c", pwd_cmd },
        .cwd = exec_cwd, .max_output_bytes = 4096,
    }) catch return;
    defer config.allocator.free(r.stdout); defer config.allocator.free(r.stderr);
    if (r.term == .Exited and r.term.Exited == 0 and r.stdout.len > 0)
        config.setCwd(std.mem.trim(u8, r.stdout, " \n\r\t"));
}

pub fn handleTerminalStream(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { command: []const u8 }, config.allocator, body, .{}) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const cmd = std.mem.trim(u8, parsed.value.command, " \t\r\n");
    if (cmd.len == 0 or cmd.len > 10000) { try http.sendError(c, 400, "Invalid command"); return; }
    
    const blocked = [_][]const u8{ "mkfs", "dd", "shutdown", "reboot" };
    for (blocked) |bl| {
        if (utils.eq(cmd, bl) or (std.mem.startsWith(u8, cmd, bl) and cmd.len > bl.len and
            (cmd[bl.len] == ' ' or cmd[bl.len] == '\t'))) {
            try http.sendError(c, 403, "Command blocked"); return;
        }
    }
    
    const exec_cwd = config.getCwd();
    var child = std.process.Child.init(&.{ "sh", "-c", cmd }, config.allocator);
    child.cwd = exec_cwd;
    child.stdout_behavior = .Pipe;
    child.stderr_behavior = .Pipe;
    child.spawn() catch |err| {
        var eb = std.ArrayList(u8).empty; defer eb.deinit(config.allocator);
        try eb.writer(config.allocator).print("spawn error: {}\n[EXIT_CODE:1]\n", .{err});
        try http.sendText(c, 200, eb.items); return;
    };
    
    const pid = child.id;
    const pid_key = blk: {
        config.proc_mutex.lock(); defer config.proc_mutex.unlock();
        config.proc_counter += 1; config.proc_map.put(config.proc_counter, pid) catch {};
        break :blk config.proc_counter;
    };
    defer { config.proc_mutex.lock(); _ = config.proc_map.remove(pid_key); config.proc_mutex.unlock(); }
    
    var out_buf = std.ArrayList(u8).empty; defer out_buf.deinit(config.allocator);
    var err_buf = std.ArrayList(u8).empty; defer err_buf.deinit(config.allocator);
    child.collectOutput(config.allocator, &out_buf, &err_buf, 10*1024*1024) catch {};
    
    const exit_code: u8 = blk: {
        const term = child.wait() catch break :blk 1;
        break :blk switch (term) { .Exited => |code| code, else => 1 };
    };
    
    tryUpdateCwd(cmd, exec_cwd);
    
    var b = std.ArrayList(u8).empty; defer b.deinit(config.allocator);
    try b.appendSlice(config.allocator, out_buf.items);
    if (err_buf.items.len > 0) try b.appendSlice(config.allocator, err_buf.items);
    try b.writer(config.allocator).print("\n[EXIT_CODE:{d}]\n", .{exit_code});
    try http.sendText(c, 200, b.items);
}

pub fn handleTerminalKill(c: std.net.Stream) !void {
    var pids = std.ArrayList(std.posix.pid_t).empty; defer pids.deinit(config.allocator);
    { config.proc_mutex.lock(); defer config.proc_mutex.unlock();
      var pit = config.proc_map.iterator();
      while (pit.next()) |entry| pids.append(config.allocator, entry.value_ptr.*) catch {};
      config.proc_map.clearRetainingCapacity(); }
    
    var killed: usize = 0;
    for (pids.items) |pid| { std.posix.kill(pid, std.posix.SIG.TERM) catch {}; killed += 1; }
    const msg = try std.fmt.allocPrint(config.allocator, "{{\"success\":true,\"message\":\"Killed {d} process(es)\"}}", .{killed});
    defer config.allocator.free(msg);
    try http.sendOkJson(c, msg);
}
