export function esc(s) {
    if (s == null)
        return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
export function formatTime(iso) {
    if (!iso)
        return "?";
    try {
        return new Date(iso).toLocaleString();
    }
    catch {
        return iso;
    }
}
export function relativeTime(iso) {
    if (!iso)
        return "";
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60000)
        return "just now";
    if (diff < 3600000)
        return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000)
        return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
}
export function formatNumber(n) {
    if (n == null)
        return "0";
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
export function formatLatency(n) {
    if (n == null)
        return "-";
    return `${formatNumber(Number(n.toFixed(2)))}ms`;
}
export function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000)
        return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}
export function getProjectName(fullPath) {
    if (!fullPath)
        return "Unknown";
    return fullPath.split("/").pop() || fullPath;
}
export function truncate(s, len) {
    if (!s)
        return "";
    s = String(s);
    return s.length > len ? s.slice(0, len) + "..." : s;
}
//# sourceMappingURL=format.js.map