const std = @import("std");

pub const PROJECT_DIR = "/data/data/com.termux/files/home/Yuyutermux";
pub const HOME_DIR = "/data/data/com.termux/files/home";
pub const MAX_FILE_SIZE: usize = 1 * 1024 * 1024;
pub const MAX_UPLOAD_SIZE: usize = 50 * 1024 * 1024;
pub const INIT_BUF: usize = 65536;
pub const PORT: u16 = 5000;
pub const AUTH_TOKEN_ENV = "YUYUTERMUX_TOKEN";

pub var gpa = std.heap.GeneralPurposeAllocator(.{}){};
pub const allocator = gpa.allocator();

// Global State
pub var proc_map: std.AutoHashMap(u32, std.posix.pid_t) = undefined;
pub var proc_counter: u32 = 0;
pub var proc_mutex: std.Thread.Mutex = .{};

pub var g_cwd: [std.fs.max_path_bytes]u8 = undefined;
pub var g_cwd_len: usize = 0;
pub var cwd_mutex: std.Thread.Mutex = .{};

pub fn getCwd() []const u8 {
    cwd_mutex.lock(); defer cwd_mutex.unlock();
    return if (g_cwd_len > 0) g_cwd[0..g_cwd_len] else PROJECT_DIR;
}

pub fn setCwd(path: []const u8) void {
    cwd_mutex.lock(); defer cwd_mutex.unlock();
    const n = @min(path.len, g_cwd.len - 1);
    @memcpy(g_cwd[0..n], path[0..n]);
    g_cwd_len = n;
}
