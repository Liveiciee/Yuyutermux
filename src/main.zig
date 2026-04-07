const std = @import("std");
const config = @import("config");
const utils = @import("utils");
const http = @import("http");
const static = @import("static");
const handlers_files = @import("handlers_files");
const handlers_exec = @import("handlers_exec");
const handlers_auth = @import("handlers_auth");
const handlers_git = @import("handlers_git");

const ConnArgs = struct { stream: std.net.Stream };

fn handleConn(args_ptr: *ConnArgs) void {
    defer config.allocator.destroy(args_ptr);
    const stream = args_ptr.stream;
    defer stream.close();

    var req = http.readReq(stream) catch return;
    defer req.deinit();

    const m = req.method;
    const p = req.path;
    const q = req.query;
    const b = req.body;

    // ── Static & pages (public) ──
    if (utils.eq(m, "GET") and std.mem.startsWith(u8, p, "/static/")) {
        static.serveStatic(stream, p) catch {}; return;
    }
    if (utils.eq(m, "GET") and (utils.eq(p, "/") or utils.eq(p, "/index.html"))) {
        static.serveTemplate(stream, "index.html") catch {}; return;
    }
    if (utils.eq(m, "GET") and utils.eq(p, "/login")) {
        static.serveTemplate(stream, "login.html") catch {}; return;
    }
    if (utils.eq(m, "GET") and utils.eq(p, "/docs")) {
        static.serveTemplate(stream, "docs.html") catch {}; return;
    }

    // ── Auth check ──
    const is_public =
        utils.eq(p, "/api/health")       or utils.eq(p, "/api/auth/login") or
        utils.eq(p, "/api/verify-token") or utils.eq(p, "/api/docs/endpoints");
    if (!is_public and !utils.checkAuth(req.hdrs, req.cookies)) {
        http.sendError(stream, 401, "Unauthorized") catch {}; return;
    }

    // ── Router ──
    if      (utils.eq(m, "GET")  and utils.eq(p, "/api/health"))             handlers_exec.handleHealth(stream)                catch {}
    else if (utils.eq(m, "GET")  and utils.eq(p, "/api/files/list"))          handlers_files.handleFilesList(stream, q)          catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/files/read"))          handlers_files.handleFilesRead(stream, b)          catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/files/write"))         handlers_files.handleFilesWrite(stream, b)         catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/files/delete"))        handlers_files.handleFilesDelete(stream, b)        catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/files/create"))        handlers_files.handleFilesCreate(stream, b)        catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/files/upload"))        {
        const ct = utils.getHeader(req.hdrs, "Content-Type") orelse "";
        handlers_files.handleFilesUpload(stream, b, ct) catch {};
    }
    else if (utils.eq(m, "GET")  and utils.eq(p, "/api/files/download"))      handlers_files.handleFilesDownload(stream, q)      catch {}
    else if (utils.eq(m, "GET")  and utils.eq(p, "/api/files/search"))        handlers_files.handleFilesSearch(stream, q)        catch {}
    else if (utils.eq(m, "GET")  and utils.eq(p, "/api/project/info"))        handlers_exec.handleProjectInfo(stream)           catch {}
    else if (utils.eq(m, "GET")  and utils.eq(p, "/api/execute/cwd"))         handlers_exec.handleTerminalCwd(stream)           catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/execute/stream"))      handlers_exec.handleTerminalStream(stream, b)     catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/execute/kill"))        handlers_exec.handleTerminalKill(stream)          catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/auth/login"))          handlers_auth.handleAuthLogin(stream, b)          catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/auth/logout"))         handlers_auth.handleAuthLogout(stream)            catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/verify-token"))        handlers_auth.handleVerifyToken(stream, b)        catch {}
    else if (utils.eq(m, "GET")  and utils.eq(p, "/api/docs/endpoints"))      handlers_auth.handleDocs(stream)                  catch {}
    else if (utils.eq(m, "GET")  and utils.eq(p, "/api/git/status"))          handlers_git.handleGitStatus(stream)             catch {}
    else if (utils.eq(m, "GET")  and utils.eq(p, "/api/git/log"))             handlers_git.handleGitLog(stream, q)             catch {}
    else if (utils.eq(m, "GET")  and utils.eq(p, "/api/git/branches"))        handlers_git.handleGitBranches(stream)           catch {}
    else if (utils.eq(m, "GET")  and utils.eq(p, "/api/git/diff"))            handlers_git.handleGitDiff(stream, q)            catch {}
    else if (utils.eq(m, "GET")  and utils.eq(p, "/api/git/config"))          handlers_git.handleGitConfigGet(stream)          catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/git/config"))          handlers_git.handleGitConfigPost(stream, b)      catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/git/init"))            handlers_git.handleGitInit(stream)               catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/git/add"))             handlers_git.handleGitAdd(stream, b)             catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/git/unstage"))         handlers_git.handleGitUnstage(stream, b)         catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/git/discard"))         handlers_git.handleGitDiscard(stream, b)         catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/git/commit"))          handlers_git.handleGitCommit(stream, b)          catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/git/push"))            handlers_git.handleGitPush(stream, b)            catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/git/pull"))            handlers_git.handleGitPull(stream, b)            catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/git/fetch"))           handlers_git.handleGitFetch(stream)              catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/git/checkout"))        handlers_git.handleGitCheckout(stream, b)        catch {}
    else if (utils.eq(m, "POST") and utils.eq(p, "/api/git/remote"))          handlers_git.handleGitRemote(stream, b)          catch {}
    else http.sendError(stream, 404, "Not found") catch {};
}

pub fn main() !void {
    defer _ = config.gpa.deinit();
    config.proc_map = std.AutoHashMap(u32, std.posix.pid_t).init(config.allocator);
    defer config.proc_map.deinit();

    const addr = try std.net.Address.parseIp4("0.0.0.0", config.PORT);
    var server = try addr.listen(.{ .reuse_address = true });
    defer server.deinit();

    std.log.info("🚀 Yuyutermux Zig server on http://0.0.0.0:{d} (31 endpoints)", .{config.PORT});

    while (true) {
        const conn = server.accept() catch |err| {
            std.log.err("accept error: {}", .{err}); continue;
        };
        const args = config.allocator.create(ConnArgs) catch { conn.stream.close(); continue; };
        args.* = .{ .stream = conn.stream };
        const thread = std.Thread.spawn(.{}, handleConn, .{args}) catch |err| {
            std.log.err("spawn error: {}", .{err});
            config.allocator.destroy(args); conn.stream.close(); continue;
        };
        thread.detach();
    }
}
