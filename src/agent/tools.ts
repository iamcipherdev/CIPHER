// Tool definitions handed to the AI model. The model can only ever emit
// structured calls against this list — it never touches the OS directly.
import type { ToolSchema } from "./providers";

function schema(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = []
): ToolSchema {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        required,
      },
    },
  };
}

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });

export const TOOL_SCHEMAS: ToolSchema[] = [
  schema(
    "create_plan",
    "ALWAYS call this first. Record a short plan (2-7 steps) for the user's request. Each step names the tool you will use.",
    {
      steps: {
        type: "array",
        description: "Ordered plan steps",
        items: {
          type: "object",
          properties: {
            description: str("What this step does, short"),
            tool: str("Which tool will be used in this step"),
          },
          required: ["description", "tool"],
        },
      },
    },
    ["steps"]
  ),
  // --- desktop applications ---
  schema("open_app", "Open an installed application by name (e.g. 'spotify', 'code', 'chrome').", { app: str("Application name or shortcut name") }, ["app"]),
  schema("close_app", "Close an application's windows gracefully. Use force=true only if a graceful close failed or the user explicitly wants a force kill.", {
    app: str("Application name"),
    force: bool("Force kill if graceful close fails"),
  }, ["app"]),
  schema("focus_app", "Bring an application's window to the foreground.", { app: str("Application name") }, ["app"]),
  schema("list_running_apps", "List currently running user applications with window titles.", {}, []),
  schema("find_installed_app", "Find where an application is installed (Start Menu shortcuts and common install dirs).", { app: str("Application name") }, ["app"]),
  // --- filesystem ---
  schema("list_directory", "List a directory's contents. Use ~ or %USERPROFILE% for home.", { path: str("Directory path") }, ["path"]),
  schema("search_files", "Search files by name under a directory (recursive).", { directory: str("Directory to search under"), pattern: str("Filename pattern, wildcards ok") }, ["directory", "pattern"]),
  schema("open_file", "Open a file with its default Windows application.", { path: str("File path") }, ["path"]),
  schema("create_folder", "Create a folder (parents are created automatically).", { path: str("Folder path") }, ["path"]),
  schema("copy_file", "Copy a file or folder. If `to` is a directory, copies into it.", { from: str("Source path"), to: str("Destination path") }, ["from", "to"]),
  schema("move_file", "Move a file or folder (never delete). If `to` is a directory, moves into it.", { from: str("Source path"), to: str("Destination path") }, ["from", "to"]),
  schema("rename_file", "Rename a file or folder within its directory.", { path: str("Path"), new_name: str("New name (no path)") }, ["path", "new_name"]),
  schema("get_file_info", "Get metadata (size, kind, modified, readonly) for a path.", { path: str("Path") }, ["path"]),
  schema("delete_file", "Delete a file (moves to Recycle Bin). HIGH RISK — the user is always asked first.", { path: str("File path") }, ["path"]),
  schema("delete_folder", "Delete a folder (moves to Recycle Bin). HIGH RISK — the user is always asked first.", { path: str("Folder path") }, ["path"]),
  // --- clipboard ---
  schema("clipboard_read", "Read text from the clipboard.", {}, []),
  schema("clipboard_write", "Write text to the clipboard.", { text: str("Text to place on the clipboard") }, ["text"]),
  // --- terminal ---
  schema("run_powershell", "Run a PowerShell command and capture stdout/stderr/exit code. Timeout 30s by default. Read-only commands run automatically; anything risky requires user permission.", { command: str("PowerShell command"), timeout_secs: num("Timeout in seconds (default 30, max 300)") }, ["command"]),
  schema("start_background_process", "Start a long-running process (dev server, watcher). Output goes to a log file; returns the pid.", { command: str("Command to run"), cwd: str("Working directory") }, ["command"]),
  schema("read_process_log", "Read captured output of a background process and whether it is still running.", { pid: num("Process id returned by start_background_process") }, ["pid"]),
  schema("stop_process", "Stop a background process CIPHER started.", { pid: num("Process id") }, ["pid"]),
  schema("check_http", "GET a URL and report the HTTP status (verify dev servers, sites).", { url: str("URL"), timeout_ms: num("Timeout ms (default 4000)") }, ["url"]),
  // --- browser ---
  schema("open_url", "Open a URL (or search text) in the system default browser. No automation.", { url: str("URL or search query") }, ["url"]),
  schema("browser_navigate", "Navigate the automation browser to a URL (requires the browser sidecar).", { url: str("Full URL") }, ["url"]),
  schema("browser_click", "Click an element by CSS selector or visible text.", { selector: str("CSS selector (optional if text given)"), text: str("Visible text to click (optional)") }, []),
  schema("browser_type", "Type text into an input/textarea by selector.", { selector: str("CSS selector"), text: str("Text to type"), submit: bool("Press Enter after typing") }, ["selector", "text"]),
  schema("browser_scroll", "Scroll the page.", { amount: num("Pixels, positive scrolls down") }, []),
  schema("browser_find", "Find elements on the page matching a text query.", { query: str("Text to search for") }, ["query"]),
  schema("browser_read_page", "Read the page: title, URL and main text content.", {}, []),
  schema("browser_screenshot", "Screenshot the automation browser page.", {}, []),
  schema("get_current_url", "Get the automation browser's current URL.", {}, []),
  schema("get_page_title", "Get the automation browser's page title.", {}, []),
  // --- system information ---
  schema("get_system_info", "Read system information: hostname, OS, CPU, RAM. No arguments.", {}, []),
  schema("get_memory_info", "Read current memory (RAM) usage: total, used, free, percent.", {}, []),
  schema("get_disk_info", "Read disk/drive usage: mount point, total, free per drive.", {}, []),
  schema("get_battery_info", "Read battery status and charge percent (desktops report no battery).", {}, []),
  schema("open_windows_settings", "Open the Windows Settings app.", {}, []),
  // --- screen ---
  schema("take_screenshot", "Capture the screen. Returns an image you can see on the next turn.", { mode: str("'full' or 'active' window") }, []),
  schema("inspect_screen", "Capture the screen and analyze it (errors on screen, what's visible). Requires a vision-capable model.", { mode: str("'full' or 'active' window") }, []),
  // --- finish ---
  schema("report_result", "Finish the task with a concise summary of what was done (this may be read aloud).", { summary: str("Final report, 1-4 sentences"), success: bool("true if the task completed") }, ["summary", "success"]),
];

// The providers module imports this array reference so both stay in sync.
import { TOOL_SCHEMAS_FOR_PROVIDER } from "./providers";
TOOL_SCHEMAS_FOR_PROVIDER.splice(0, TOOL_SCHEMAS_FOR_PROVIDER.length, ...TOOL_SCHEMAS);

/** Tools whose output is external computer/internet content — wrapped as data. */
export const EXTERNAL_TOOLS = new Set([
  "browser_read_page",
  "browser_find",
  "clipboard_read",
  "run_powershell",
  "read_process_log",
  "search_files",
  "list_directory",
  "get_file_info",
  "take_screenshot",
  "inspect_screen",
  "browser_screenshot",
  "get_page_title",
]);
