use tokio::process::{Child, Command};

fn isolate(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    #[cfg(not(unix))]
    let _ = command;
}

pub(crate) fn spawn(command: &mut Command) -> std::io::Result<(Child, ProcessGroup)> {
    isolate(command);
    let child = command.spawn()?;
    let group = ProcessGroup::for_child(&child);
    Ok((child, group))
}

pub(crate) struct ProcessGroup {
    #[cfg(unix)]
    id: Option<i32>,
}
impl ProcessGroup {
    fn for_child(child: &Child) -> Self {
        #[cfg(unix)]
        {
            Self {
                id: child
                    .id()
                    .and_then(|id| i32::try_from(id).ok())
                    .filter(|id| *id > 0),
            }
        }
        #[cfg(not(unix))]
        {
            let _ = child;
            Self {}
        }
    }
    pub(crate) fn disarm(&mut self) {
        #[cfg(unix)]
        {
            self.id = None;
        }
    }
    pub(crate) fn terminate(&mut self) {
        #[cfg(unix)]
        if let Some(id) = self.id.take() {
            unsafe extern "C" {
                fn kill(pid: i32, signal: i32) -> i32;
            }
            // The leader was spawned in its own group and has not been reaped, so its ID cannot be reused.
            // Kill the group before waiting: npm CLI wrappers otherwise leave the actual engine running.
            unsafe {
                kill(-id, 9);
            }
        }
    }
}
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        self.terminate();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Stdio;
    use std::time::Duration;
    use tokio::io::AsyncReadExt;

    async fn wrapper() -> (Child, ProcessGroup, tokio::process::ChildStdout) {
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "sleep 30 & wait"])
            .stdout(Stdio::piped())
            .kill_on_drop(true);
        let (mut child, group) = spawn(&mut command).unwrap();
        let stdout = child.stdout.take().unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        (child, group, stdout)
    }

    #[tokio::test]
    async fn cancellation_closes_a_descendants_inherited_pipe() {
        let (mut child, mut group, mut stdout) = wrapper().await;
        group.terminate();
        tokio::time::timeout(Duration::from_secs(2), child.wait())
            .await
            .unwrap()
            .unwrap();
        let mut bytes = Vec::new();
        tokio::time::timeout(Duration::from_secs(2), stdout.read_to_end(&mut bytes))
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn abandoned_run_also_terminates_its_group() {
        let (mut child, group, mut stdout) = wrapper().await;
        drop(group);
        tokio::time::timeout(Duration::from_secs(2), child.wait())
            .await
            .unwrap()
            .unwrap();
        let mut bytes = Vec::new();
        tokio::time::timeout(Duration::from_secs(2), stdout.read_to_end(&mut bytes))
            .await
            .unwrap()
            .unwrap();
    }
}
