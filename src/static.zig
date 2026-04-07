const std = @import("std");
const config = @import("config");
const utils = @import("utils");
const http = @import("http");

pub fn mimeType(ext: []const u8) []const u8 {
    if (utils.eq(ext, ".html")) return "text/html; charset=utf-8";
    if (utils.eq(ext, ".css")) return "text/css";
    if (utils.eq(ext, ".js")) return "application/javascript";
    if (utils.eq(ext, ".json")) return "application/json";
    if (utils.eq(ext, ".png")) return "image/png";
    if (utils.eq(ext, ".jpg") or utils.eq(ext, ".jpeg")) return "image/jpeg";
    if (utils.eq(ext, ".gif")) return "image/gif";
    if (utils.eq(ext, ".svg")) return "image/svg+xml";
    if (utils.eq(ext, ".ico")) return "image/x-icon";
    if (utils.eq(ext, ".woff2")) return "font/woff2";
    if (utils.eq(ext, ".woff")) return "font/woff";
    if (utils.eq(ext, ".ttf")) return "font/ttf";
    return "application/octet-stream";
}

pub fn serveStatic(c: std.net.Stream, url_path: []const u8) !void {
    if (std.mem.indexOf(u8, url_path, "..") != null) { try http.sendError(c, 403, "Forbidden"); return; }
    const rel = if (url_path.len > 0 and url_path[0] == '/') url_path[1..] else url_path;
    const disk = try std.fs.path.join(config.allocator, &.{ config.PROJECT_DIR, rel });
    defer config.allocator.free(disk);
    var buf: [std.fs.max_path_bytes]u8 = undefined;
    const resolved = std.fs.realpath(disk, &buf) catch { try http.sendError(c, 404, "Not found"); return; };
    if (!std.mem.startsWith(u8, resolved, config.PROJECT_DIR)) { try http.sendError(c, 403, "Forbidden"); return; }
    var file = std.fs.openFileAbsolute(resolved, .{}) catch { try http.sendError(c, 404, "Not found"); return; };
    defer file.close();
    const st = try file.stat();
    if (st.size > 10*1024*1024) { try http.sendError(c, 413, "Too large"); return; }
    const content = try file.readToEndAlloc(config.allocator, st.size+1);
    defer config.allocator.free(content);
    try http.writeRaw(c, 200, mimeType(std.fs.path.extension(resolved)), "", content);
}

pub fn serveTemplate(c: std.net.Stream, name: []const u8) !void {
    const path = try std.fs.path.join(config.allocator, &.{ config.PROJECT_DIR, "templates", name });
    defer config.allocator.free(path);
    var file = std.fs.openFileAbsolute(path, .{}) catch { try http.sendError(c, 404, "Template not found"); return; };
    defer file.close();
    const st = try file.stat();
    const content = try file.readToEndAlloc(config.allocator, st.size+1);
    defer config.allocator.free(content);
    try http.writeRaw(c, 200, "text/html; charset=utf-8", "", content);
}
