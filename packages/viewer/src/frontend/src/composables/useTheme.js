import { ref, watch } from "vue";
const theme = ref("dark");
export function useTheme() {
    function initTheme() {
        try {
            const saved = localStorage.getItem("ot-theme");
            if (saved) {
                theme.value = saved;
            }
        }
        catch { }
        applyTheme();
    }
    function applyTheme() {
        document.documentElement.setAttribute("data-theme", theme.value);
    }
    function toggleTheme() {
        theme.value = theme.value === "dark" ? "light" : "dark";
        try {
            localStorage.setItem("ot-theme", theme.value);
        }
        catch { }
        applyTheme();
    }
    watch(theme, applyTheme);
    return { theme, toggleTheme, initTheme };
}
//# sourceMappingURL=useTheme.js.map