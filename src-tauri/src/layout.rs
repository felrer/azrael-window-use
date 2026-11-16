use std::{
    env,
    ffi::OsString,
    path::PathBuf,
    process::{Command, Stdio},
};

#[derive(Clone, Debug)]
pub struct Layout {
    pub executable: PathBuf,
    pub resources: PathBuf,
    pub app: PathBuf,
    pub node: PathBuf,
    pub packaged: bool,
}

impl Layout {
    pub fn resolve() -> Result<Self, String> {
        let executable = env::current_exe().map_err(|e| e.to_string())?;
        let development = env::var_os("AZ_WINDOW_USE_DEV_ROOT").map(PathBuf::from);
        let packaged = development.is_none();
        let resources = if let Some(root) = &development {
            if !root.is_absolute() {
                return Err("AZ_WINDOW_USE_DEV_ROOT must be absolute".into());
            }
            env::var_os("AZ_WINDOW_USE_RESOURCES")
                .map(PathBuf::from)
                .unwrap_or_else(|| root.join("artifacts/tauri-resources"))
        } else {
            let parent = executable.parent().ok_or("Missing executable directory")?;
            if cfg!(target_os = "macos") {
                parent
                    .parent()
                    .ok_or("Missing bundle Contents")?
                    .join("Resources")
            } else {
                parent.join("resources")
            }
        };
        let app = development.clone().unwrap_or_else(|| resources.join("app"));
        let node = if packaged {
            resources
                .join("node")
                .join(if cfg!(windows) { "node.exe" } else { "node" })
        } else {
            env::var_os("AZ_WINDOW_USE_NODE")
                .map(PathBuf::from)
                .ok_or("Development requires absolute AZ_WINDOW_USE_NODE")?
        };
        if !resources.is_absolute() || !node.is_absolute() {
            return Err("Node and resource paths must be absolute".into());
        }
        if !node.is_file() || !app.join("src/main.cjs").is_file() {
            return Err("Window Use Node runtime or application resources are missing".into());
        }
        Ok(Self {
            executable,
            resources,
            app,
            node,
            packaged,
        })
    }

    pub fn command(&self, arguments: &[OsString], worker: bool) -> Command {
        let mut command = Command::new(&self.node);
        command.arg(self.app.join("src/main.cjs"));
        if worker {
            command.arg("--host-worker");
        }
        command
            .args(arguments)
            .current_dir(&self.app)
            .env("AZ_WINDOW_USE_HOST_EXECUTABLE", &self.executable)
            .env("AZ_WINDOW_USE_RESOURCES", &self.resources)
            .env("AZ_WINDOW_USE_NODE", &self.node)
            .env_remove("ELECTRON_RUN_AS_NODE")
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH");
        if self.packaged {
            command.env("AZ_WINDOW_USE_PACKAGED", "1");
        } else {
            command.env_remove("AZ_WINDOW_USE_PACKAGED");
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // Keep inherited pipes for MCP without opening a Node console window.
            command.creation_flags(0x08000000);
        }
        command
    }

    pub fn run_stdio(&self, arguments: &[OsString]) -> Result<i32, String> {
        self.command(arguments, false)
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .map(|status| status.code().unwrap_or(1))
            .map_err(|error| format!("Window Use Node launch failed: {error}"))
    }
}

pub fn is_stdio(arguments: &[OsString]) -> bool {
    arguments
        .iter()
        .any(|arg| arg == "--mcp" || arg == "--mcp-pipe")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mcp_modes_skip_desktop_bootstrap() {
        for flag in ["--mcp", "--mcp-pipe"] {
            assert!(is_stdio(&[
                "--user-data-dir".into(),
                "profile".into(),
                flag.into()
            ]));
        }
        assert!(!is_stdio(&["--mcp-extra".into()]));
    }
}
