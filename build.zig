const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // ===== modules =====
    const config_mod = b.createModule(.{
        .root_source_file = b.path("src/config.zig"),
        .target = target,
        .optimize = optimize,
    });

    const utils_mod = b.createModule(.{
        .root_source_file = b.path("src/utils.zig"),
        .target = target,
        .optimize = optimize,
    });

    const http_mod = b.createModule(.{
        .root_source_file = b.path("src/http.zig"),
        .target = target,
        .optimize = optimize,
    });

    const static_mod = b.createModule(.{
        .root_source_file = b.path("src/static.zig"),
        .target = target,
        .optimize = optimize,
    });

    const files_mod = b.createModule(.{
        .root_source_file = b.path("src/handlers_files.zig"),
        .target = target,
        .optimize = optimize,
    });

    const exec_mod = b.createModule(.{
        .root_source_file = b.path("src/handlers_exec.zig"),
        .target = target,
        .optimize = optimize,
    });

    const auth_mod = b.createModule(.{
        .root_source_file = b.path("src/handlers_auth.zig"),
        .target = target,
        .optimize = optimize,
    });

    const git_mod = b.createModule(.{
        .root_source_file = b.path("src/handlers_git.zig"),
        .target = target,
        .optimize = optimize,
    });

    // ===== inject dependencies (IMPORTANT) =====
    // config = base
    utils_mod.addImport("config", config_mod);

    http_mod.addImport("config", config_mod);
    http_mod.addImport("utils", utils_mod);

    static_mod.addImport("config", config_mod);
    static_mod.addImport("utils", utils_mod);
    static_mod.addImport("http", http_mod);

    files_mod.addImport("config", config_mod);
    files_mod.addImport("utils", utils_mod);
    files_mod.addImport("http", http_mod);

    exec_mod.addImport("config", config_mod);
    exec_mod.addImport("utils", utils_mod);
    exec_mod.addImport("http", http_mod);

    auth_mod.addImport("config", config_mod);
    auth_mod.addImport("utils", utils_mod);
    auth_mod.addImport("http", http_mod);

    git_mod.addImport("config", config_mod);
    git_mod.addImport("utils", utils_mod);
    git_mod.addImport("http", http_mod);

    // ===== root module =====
    const root_mod = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });

    // inject ALL ke root
    root_mod.addImport("config", config_mod);
    root_mod.addImport("utils", utils_mod);
    root_mod.addImport("http", http_mod);
    root_mod.addImport("static", static_mod);
    root_mod.addImport("handlers_files", files_mod);
    root_mod.addImport("handlers_exec", exec_mod);
    root_mod.addImport("handlers_auth", auth_mod);
    root_mod.addImport("handlers_git", git_mod);

    // ===== executable =====
    const exe = b.addExecutable(.{
        .name = "api",
        .root_module = root_mod,
    });

    exe.linkLibC();

    b.installArtifact(exe);

    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());

    if (b.args) |args| run_cmd.addArgs(args);

    const run_step = b.step("run", "Run the server");
    run_step.dependOn(&run_cmd.step);
}
