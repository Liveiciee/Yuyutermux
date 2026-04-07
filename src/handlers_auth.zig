const std = @import("std");
const config = @import("config");
const utils = @import("utils");
const http = @import("http");

pub fn handleAuthLogin(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { token: []const u8 }, config.allocator, body, .{}) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const tok_env = utils.getAuthToken(); defer if (tok_env) |t| config.allocator.free(t);
    if (tok_env != null and !utils.eq(parsed.value.token, tok_env.?)) {
        try http.sendError(c, 401, "Authentication failed"); return;
    }
    const bj = "{\"success\":true,\"redirect\":\"/\"}";
    const resp = try std.fmt.allocPrint(config.allocator,
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n" ++
        "Set-Cookie: yuyu_token={s}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000\r\n" ++
        "Set-Cookie: yuyu_authed=1; Path=/; Max-Age=2592000\r\n" ++
        "Content-Length: {d}\r\n\r\n{s}", .{ parsed.value.token, bj.len, bj });
    defer config.allocator.free(resp);
    try c.writeAll(resp);
}

pub fn handleAuthLogout(c: std.net.Stream) !void {
    const bj = "{\"success\":true,\"redirect\":\"/login\"}";
    const resp = try std.fmt.allocPrint(config.allocator,
        "HTTP/1.1 200 OK\r\n" ++
        "Set-Cookie: yuyu_token=; Path=/; Max-Age=0\r\n" ++
        "Set-Cookie: yuyu_authed=; Path=/; Max-Age=0\r\n" ++
        "Content-Type: application/json\r\n" ++
        "Content-Length: {d}\r\n\r\n{s}", .{ bj.len, bj });
    defer config.allocator.free(resp);
    try c.writeAll(resp);
}

pub fn handleVerifyToken(c: std.net.Stream, body: []const u8) !void {
    const parsed = std.json.parseFromSlice(struct { token: []const u8 }, config.allocator, body, .{}) catch {
        try http.sendError(c, 400, "Invalid JSON"); return;
    };
    defer parsed.deinit();
    const tok_env = utils.getAuthToken(); defer if (tok_env) |t| config.allocator.free(t);
    const valid = tok_env == null or utils.eq(parsed.value.token, tok_env.?);
    try http.sendOkJson(c, if (valid) "{\"valid\":true}" else "{\"valid\":false}");
}

pub fn handleDocs(c: std.net.Stream) !void {
    try http.sendOkJson(c,
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
