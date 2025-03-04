use super::task::{CommandLookup, Task};
use super::{
    action::Action,
    components::{help_popup::HelpPopup, tasks_list::TasksList, Component},
    tui,
};
use crate::native::tui::components::terminal_pane::{TerminalPane, TerminalPaneData, TerminalPaneState};
use crate::native::tui::tui::Tui;
use color_eyre::eyre::Result;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseEventKind};
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction};
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::Modifier;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use std::io;
use ratatui::Frame;
use tokio::sync::mpsc;
use tokio::sync::mpsc::UnboundedSender;
use tracing::debug;

pub struct App {
    pub tick_rate: f64,
    pub frame_rate: f64,
    pub components: Vec<Box<dyn Component>>,
    pub should_quit: bool,
    pub last_tick_key_events: Vec<KeyEvent>,
    focus: Focus,
    previous_focus: Focus,
    done_callback: Option<ThreadsafeFunction<(), ErrorStrategy::Fatal>>,
    terminal_pane_data: [TerminalPaneData; 2],
    pane_tasks: [Option<String>; 2], // Tasks assigned to panes 1 and 2 (0-indexed)
    spacebar_mode: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Focus {
    TaskList,
    TerminalPane(usize),
    HelpPopup,
}

impl App {
    pub fn new(
        tick_rate: f64,
        frame_rate: f64,
        tasks: Vec<Task>,
        target_names: Vec<String>,
        command_lookup: CommandLookup,
    ) -> Result<Self> {
        let tasks_list = TasksList::new(tasks, target_names, command_lookup);
        let help_popup = HelpPopup::new();

        let components: Vec<Box<dyn Component>> = vec![Box::new(tasks_list), Box::new(help_popup)];

        Ok(Self {
            tick_rate,
            frame_rate,
            components,
            done_callback: None,
            should_quit: false,
            last_tick_key_events: Vec::new(),
            focus: Focus::TaskList,
            previous_focus: Focus::TaskList,
            terminal_pane_data: [TerminalPaneData::new(), TerminalPaneData::new()],
            pane_tasks: [None, None],
            spacebar_mode: false,
        })
    }

    // Only needed for the prototype testing mode via main.rs
    // TODO: Remove this after Nx integration
    pub fn queue_all_tasks(&mut self) {
        if let Some(tasks_list) = self
            .components
            .iter_mut()
            .find_map(|c| c.as_any_mut().downcast_mut::<TasksList>())
        {
            tasks_list.queue_all_tasks();
        }
    }

    pub fn handle_event(
        &mut self,
        event: tui::Event,
        action_tx: &mpsc::UnboundedSender<Action>,
    ) -> Result<bool> {
        match event {
            tui::Event::Quit => {
                action_tx.send(Action::Quit)?;
                return Ok(true);
            }
            tui::Event::Tick => action_tx.send(Action::Tick)?,
            tui::Event::Render => action_tx.send(Action::Render)?,
            tui::Event::Resize(x, y) => action_tx.send(Action::Resize(x, y))?,
            tui::Event::Key(key) => {
                debug!("Handling Key Event: {:?}", key);
                // Handle Ctrl+C to quit
                if key.code == KeyCode::Char('c') && key.modifiers == KeyModifiers::CONTROL {
                    return Ok(true);
                }

                if let Focus::TerminalPane(pane_idx) = self.focus {
                    if !self.is_interactive_mode() {
                        match key.code {
                            KeyCode::Tab => {
                                self.focus_next();
                            }
                            KeyCode::BackTab => {
                                self.focus_previous();
                            }
                            KeyCode::Char('b') => {
                                self.toggle_task_list();
                            }
                            _ => {
                                let terminal_pane_data = &mut self.terminal_pane_data[pane_idx];
                                // Forward other keys for interactivity, scrolling (j/k) etc
                                terminal_pane_data.handle_key_event(key).ok();
                            }
                        }
                    } else {
                        let terminal_pane_data = &mut self.terminal_pane_data[pane_idx];
                        // Forward all key events to the currently focused pane in interactive mode
                        terminal_pane_data.handle_key_event(key)?;
                    }

                    return Ok(false);
                };

                // Only handle '?' key if we're not in interactive mode
                if matches!(key.code, KeyCode::Char('?')) && !self.is_interactive_mode() {
                    let show_help_popup = !matches!(self.focus, Focus::HelpPopup);
                    if let Some(help_popup) = self
                        .components
                        .iter_mut()
                        .find_map(|c| c.as_any_mut().downcast_mut::<HelpPopup>())
                    {
                        help_popup.set_visible(show_help_popup);
                    }
                    if show_help_popup {
                        self.previous_focus = self.focus;
                        self.focus = Focus::HelpPopup;
                    } else {
                        self.focus = self.previous_focus;
                    }
                    return Ok(false);
                }

                // If shortcuts popup is open, handle its keyboard events
                if matches!(self.focus, Focus::HelpPopup) {
                    match key.code {
                        KeyCode::Esc => {
                            if let Some(help_popup) = self
                                .components
                                .iter_mut()
                                .find_map(|c| c.as_any_mut().downcast_mut::<HelpPopup>())
                            {
                                help_popup.set_visible(false);
                            }
                            self.focus = self.previous_focus;
                        }
                        KeyCode::Up | KeyCode::Char('k') => {
                            if let Some(help_popup) = self
                                .components
                                .iter_mut()
                                .find_map(|c| c.as_any_mut().downcast_mut::<HelpPopup>())
                            {
                                help_popup.scroll_up();
                            }
                            return Ok(false);
                        }
                        KeyCode::Down | KeyCode::Char('j') => {
                            if let Some(help_popup) = self
                                .components
                                .iter_mut()
                                .find_map(|c| c.as_any_mut().downcast_mut::<HelpPopup>())
                            {
                                help_popup.scroll_down();
                            }
                            return Ok(false);
                        }
                        _ => {}
                    }
                    return Ok(false);
                }

                // Handle spacebar toggle regardless of focus
                if key.code == KeyCode::Char(' ') {
                    self.toggle_output_visibility();
                    return Ok(false); // Skip other key handling
                }

                if matches!(self.focus, Focus::TaskList) {

                    let mut tasks_list = self.get_tasks_list_mut();
                    match key.code {
                        KeyCode::Down | KeyCode::Char('j') => {
                            tasks_list.next();
                        }
                        KeyCode::Up | KeyCode::Char('k') => {
                            tasks_list.previous();
                        }
                        KeyCode::Left => {
                            tasks_list.previous_page();
                        }
                        KeyCode::Right => {
                            tasks_list.next_page();
                        }
                        KeyCode::Esc => {
                            tasks_list.clear_filter();
                        }
                        KeyCode::Char(c) if tasks_list.filter_mode => {
                            tasks_list.add_filter_char(c);
                        }
                        KeyCode::Backspace if tasks_list.filter_mode => {
                            tasks_list.remove_filter_char();
                        }
                        KeyCode::Char('/') => {
                            if tasks_list.filter_mode {
                                // Pretty sure this is unreachable
                                // Could be a bug where '/' will add a char instead of exit filter mode... which may be a feature?
                                tasks_list.exit_filter_mode();
                            } else {
                                tasks_list.enter_filter_mode();
                            }
                        }
                        KeyCode::Char('h') => {
                            tasks_list.previous_page();
                        }
                        KeyCode::Char('l') => {
                            tasks_list.next_page();
                        }
                        KeyCode::Char('b') => {
                            self.toggle_task_list();
                        }
                        KeyCode::Char('q') => {
                            self.should_quit = true;
                        }
                        KeyCode::Char('0') => {
                            self.clear_all_panes();
                        }
                        KeyCode::Char('1') => {
                            self.assign_current_task_to_pane(0);
                        }
                        KeyCode::Char('2') => {
                            self.assign_current_task_to_pane(1);
                        }
                        _ => {}
                    }

                    if self.spacebar_mode {
                        let tasks_list = self.get_tasks_list();
                        if let Some(task_name) = tasks_list.get_selected_task_name() {
                            self.pane_tasks[0] = Some(task_name.clone());
                        }
                    }
                }
            }
            tui::Event::Mouse(mouse_event) => match self.focus {
                Focus::TerminalPane(pane_idx) => match mouse_event.kind {
                    MouseEventKind::ScrollUp => {
                        self.terminal_pane_data[pane_idx]
                            .handle_key_event(KeyEvent::new(KeyCode::Up, KeyModifiers::empty()))
                            .ok();
                    }
                    MouseEventKind::ScrollDown => {
                        self.terminal_pane_data[pane_idx]
                            .handle_key_event(KeyEvent::new(KeyCode::Down, KeyModifiers::empty()))
                            .ok();
                    }
                    _ => {}
                },
                Focus::TaskList => {
                    let tasks_list = self.get_tasks_list_mut();

                    match mouse_event.kind {
                        MouseEventKind::ScrollUp => {
                            tasks_list.previous();
                        }
                        MouseEventKind::ScrollDown => {
                            tasks_list.next();
                        }
                        _ => {}
                    }
                }
                _ => {}
            },
            _ => {}
        }

        for component in self.components.iter_mut() {
            if let Some(action) = component.handle_events(Some(event.clone()))? {
                action_tx.send(action)?;
            }
        }

        Ok(false)
    }

    pub fn handle_action(
        &mut self,
        tui: &mut Tui,
        action: Action,
        action_tx: &UnboundedSender<Action>,
    ) {
        if action != Action::Tick && action != Action::Render {
            log::debug!("{action:?}");
        }
        match action {
            Action::Tick => {
                self.last_tick_key_events.drain(..);
            }
            Action::Quit => self.should_quit = true,
            Action::Resize(w, h) => {
                tui.resize(Rect::new(0, 0, w, h)).ok();

                // Ensure the help popup is resized correctly
                if let Some(help_popup) = self
                    .components
                    .iter_mut()
                    .find_map(|c| c.as_any_mut().downcast_mut::<HelpPopup>())
                {
                    help_popup.handle_resize(w, h);
                }

                // Propagate resize to PTY instances
                if let Some(tasks_list) = self
                    .components
                    .iter_mut()
                    .find_map(|c| c.as_any_mut().downcast_mut::<TasksList>())
                {
                    tasks_list.handle_resize(w, h).ok();
                }
                tui.draw(|f| {
                    for component in self.components.iter_mut() {
                        let r = component.draw(f, f.area());
                        if let Err(e) = r {
                            action_tx
                                .send(Action::Error(format!("Failed to draw: {:?}", e)))
                                .ok();
                        }
                    }
                })
                .ok();
            }
            Action::Render => {
                tui.draw(|f| {
                let area = f.area();

                // Check for minimum viable viewport size at the app level
                if area.height < 12 || area.width < 40 {
                    let message = Line::from(vec![
                        Span::raw("  "),
                        Span::styled(
                            " NX ",
                            Style::reset()
                                .add_modifier(Modifier::BOLD)
                                .bg(Color::Red)
                                .fg(Color::Black),
                        ),
                        Span::raw("  "),
                        Span::raw("Please make your terminal viewport larger in order to view the tasks UI"),
                    ]);

                    // Create empty lines for vertical centering
                    let empty_line = Line::from("");
                    let mut lines = vec![];

                    // Add empty lines to center vertically
                    let vertical_padding = (area.height as usize).saturating_sub(3) / 2;
                    for _ in 0..vertical_padding {
                        lines.push(empty_line.clone());
                    }

                    // Add the message
                    lines.push(message);

                    let paragraph = Paragraph::new(lines)
                        .alignment(Alignment::Center);
                    f.render_widget(paragraph, area);
                    return;
                }

                // Only render components if viewport is large enough
                // Draw main components with dimming if popup is focused
                for component in self.components.iter_mut() {
                    if let Some(tasks_list) =
                        component.as_any_mut().downcast_mut::<TasksList>()
                    {
                        tasks_list.set_dimmed(matches!(self.focus, Focus::HelpPopup));
                    }
                    let r = component.draw(f, f.area());
                    if let Err(e) = r {
                        action_tx
                            .send(Action::Error(format!("Failed to draw: {:?}", e)))
                            .ok();
                    }
                }
            }).ok();
            }
            _ => {}
        }

        // Update components
        for component in self.components.iter_mut() {
            if let Ok(Some(new_action)) = component.update(action.clone()) {
                action_tx.send(new_action).ok();
            }
        }
    }

    pub fn set_done_callback(
        &mut self,
        done_callback: ThreadsafeFunction<(), ErrorStrategy::Fatal>,
    ) {
        self.done_callback = Some(done_callback);
    }

    pub fn call_done_callback(&self) {
        if let Some(cb) = &self.done_callback {
            cb.call(
                (),
                napi::threadsafe_function::ThreadsafeFunctionCallMode::Blocking,
            );
        }
    }

    pub fn is_interactive_mode(&self) -> bool {
        match self.focus {
            Focus::TerminalPane(pane_idx) => self.terminal_pane_data[pane_idx].is_interactive(),
            _ => false,
        }
    }

    pub fn focus(&self) -> Focus {
        self.focus
    }

    pub fn focus_next(&mut self) {
        let num_panes = self.pane_tasks.iter().filter(|t| t.is_some()).count();
        if num_panes == 0 {
            return; // No panes to focus
        }

        self.focus = match self.focus {
            Focus::TaskList => {
                // Move to first visible pane
                if let Some(first_pane) = self.pane_tasks.iter().position(|t| t.is_some()) {
                    Focus::TerminalPane(first_pane)
                } else {
                    Focus::TaskList
                }
            }
            Focus::TerminalPane(current_pane) => {
                // Find next visible pane or go back to task list
                let next_pane = (current_pane + 1..2).find(|&idx| self.pane_tasks[idx].is_some());

                match next_pane {
                    Some(pane) => Focus::TerminalPane(pane),
                    None => Focus::TaskList,
                }
            }
            Focus::HelpPopup => Focus::TaskList,
        };
    }

    pub fn focus_previous(&mut self) {
        let num_panes = self.pane_tasks.iter().filter(|t| t.is_some()).count();
        if num_panes == 0 {
            return; // No panes to focus
        }

        self.focus = match self.focus {
            Focus::TaskList => {
                // Move to last visible pane
                if let Some(last_pane) = (0..2).rev().find(|&idx| self.pane_tasks[idx].is_some()) {
                    Focus::TerminalPane(last_pane)
                } else {
                    Focus::TaskList
                }
            }
            Focus::TerminalPane(current_pane) => {
                // Find previous visible pane or go back to task list
                if current_pane > 0 {
                    if let Some(prev_pane) = (0..current_pane)
                        .rev()
                        .find(|&idx| self.pane_tasks[idx].is_some())
                    {
                        Focus::TerminalPane(prev_pane)
                    } else {
                        Focus::TaskList
                    }
                } else {
                    Focus::TaskList
                }
            }
            Focus::HelpPopup => Focus::TaskList,
        };
    }

    /// Checks if the current view has any visible output panes.
    pub fn has_visible_panes(&self) -> bool {
        self.pane_tasks.iter().any(|t| t.is_some())
    }

    /// Moves the selection to the next task in the list.
    /// If in spacebar mode, updates the output pane to show the newly selected task.
    fn next_task(&mut self, tasks_list: &mut TasksList) {
        tasks_list.next();

        // Only update pane 1 if we're in spacebar mode
        if self.spacebar_mode {
            if let Some(task_name) = tasks_list.get_selected_task_name() {
                self.pane_tasks[0] = Some(task_name.clone());
            }
        }
        tasks_list.reset_scroll();
    }

    fn assign_current_task_to_pane(&mut self, pane_idx: usize) {
        let tasks_list = self.get_tasks_list();
        if let Some(task_name) = tasks_list.get_selected_task_name() {
            // If we're in spacebar mode and this is pane 0, convert to pinned mode
            if self.spacebar_mode && pane_idx == 0 {
                self.spacebar_mode = false;
                self.focus = Focus::TerminalPane(pane_idx);
                return;
            }

            // Check if the task is already pinned to the pane
            if self.pane_tasks[pane_idx].as_deref() == Some(task_name.as_str()) {
                // Unpin the task if it's already pinned
                self.pane_tasks[pane_idx] = None;

                // Adjust focused pane if necessary
                if !self.has_visible_panes() {
                    self.focus = Focus::TaskList;
                    self.spacebar_mode = false;
                }
                return;
            }

            // Pin the task to the specified pane
            self.pane_tasks[pane_idx] = Some(task_name.clone());
            self.focus = Focus::TaskList;
            self.spacebar_mode = false; // Exit spacebar mode when pinning
        }
    }

    fn clear_all_panes(&mut self) {
        self.pane_tasks = [None, None];
        self.spacebar_mode = false;
        self.focus = Focus::TaskList;
    }

    /// Toggles the visibility of the output pane for the currently selected task.
    /// In spacebar mode, the output follows the task selection.
    pub fn toggle_output_visibility(&mut self) {
        let has_visible_panes = self.has_visible_panes();
        let tasks_list = self.get_tasks_list_mut();
        // Ensure task list is visible after every spacebar interaction
        tasks_list.hide();

        if let Some(task_name) = tasks_list.get_selected_task_name() {
            if has_visible_panes {
                // Always clear all panes when toggling with spacebar
                self.clear_all_panes();
                self.spacebar_mode = false;
            } else {
                // Show current task in pane 1 in spacebar mode
                self.pane_tasks = [Some(task_name.clone()), None];
                self.spacebar_mode = true; // Enter spacebar mode
            }
        }
    }

    /// Toggles the visibility of the task list panel
    fn toggle_task_list(&mut self) {
        // Only allow hiding if at least one pane is visible
        if self.has_visible_panes() {
            let tasks_list = self.get_tasks_list_mut();
            tasks_list.toggle();
        }
    }

    fn get_tasks_list(&self) -> &TasksList {
        self.components
            .iter()
            .find_map(|c| c.as_any().downcast_ref::<TasksList>())
            .expect("TasksList component does not exist")
    }

    fn get_tasks_list_mut(&mut self) -> &mut TasksList {
        self.components
            .iter_mut()
            .find_map(|c| c.as_any_mut().downcast_mut::<TasksList>())
            .expect("TasksList component does not exist")
    }

    pub fn draw_terminal_panes(&mut self, f: &mut Frame<'_>, area: Rect) -> Result<()> {

        let num_active_panes = self.pane_tasks.iter().filter(|t| t.is_some()).count();

        match num_active_panes {
            0 => (), // No panes to render
            1 => {
                if self.pane_tasks[1].is_some() {
                    let output_chunks = Layout::default()
                        .direction(Direction::Horizontal)
                        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
                        .spacing(2)
                        .split(output_area);

                    // Render placeholder for pane 1
                    let placeholder = Paragraph::new("Press 1 on a task to show it here")
                        .block(
                            Block::default()
                                .title("  Output 1  ")
                                .borders(Borders::ALL)
                                .border_style(Style::default().fg(Color::DarkGray)),
                        )
                        .style(Style::default().fg(Color::DarkGray))
                        .alignment(Alignment::Center);

                    f.render_widget(placeholder, output_chunks[0]);

                    // Get task data before rendering
                    if let Some(task_name) = &self.pane_tasks[1] {
                        if let Some(task) = self.tasks.iter_mut().find(|t| t.name == *task_name)
                        {
                            let mut terminal_pane_data = &mut self.terminal_pane_data[1];
                            terminal_pane_data.status = task.status;
                            terminal_pane_data.is_continuous = task.continuous;

                            if let Some(pty) = &mut task.pty {
                                terminal_pane_data.pty = Some(pty.clone());
                            }

                            let is_focused = match self.focus {
                                Focus::TerminalPane(focused_pane_idx) => {
                                    1 == focused_pane_idx
                                }
                                _ => false,
                            };
                            let mut state = TerminalPaneState::default();

                            let terminal_pane = TerminalPane::new()
                                .task_name(task.name.clone())
                                .pty_data(&mut terminal_pane_data)
                                .focused(is_focused)
                                .continuous(task.continuous);

                            f.render_stateful_widget(
                                terminal_pane,
                                output_chunks[1],
                                &mut state,
                            );
                        }
                    }
                } else if let Some((pane_idx, Some(task_name))) = self
                    .pane_tasks
                    .iter()
                    .enumerate()
                    .find(|(_, t)| t.is_some())
                {
                    if let Some(task) = self.tasks.iter_mut().find(|t| t.name == *task_name) {
                        let mut terminal_pane_data = &mut self.terminal_pane_data[pane_idx];
                        terminal_pane_data.status = task.status;
                        terminal_pane_data.is_continuous = task.continuous;

                        if let Some(pty) = &mut task.pty {
                            terminal_pane_data.pty = Some(pty.clone());
                        }

                        let is_focused = match self.focus {
                            Focus::TerminalPane(focused_pane_idx) => 0 == focused_pane_idx,
                            _ => false,
                        };
                        let mut state = TerminalPaneState::default();

                        let terminal_pane = TerminalPane::new()
                            .task_name(task.name.clone())
                            .pty_data(&mut terminal_pane_data)
                            .focused(is_focused)
                            .continuous(task.continuous);

                        f.render_stateful_widget(terminal_pane, output_area, &mut state);
                    }
                }
            }
            _ => {
                let output_chunks = Layout::default()
                    .direction(Direction::Horizontal)
                    .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
                    .spacing(2)
                    .split(output_area);

                for (pane_idx, chunk) in output_chunks.iter().enumerate() {
                    if let Some(task_name) = &self.pane_tasks[pane_idx] {
                        if let Some(task) = self.tasks.iter_mut().find(|t| t.name == *task_name)
                        {
                            let mut terminal_pane_data = &mut self.terminal_pane_data[pane_idx];
                            terminal_pane_data.status = task.status;
                            terminal_pane_data.is_continuous = task.continuous;

                            if let Some(pty) = &mut task.pty {
                                terminal_pane_data.pty = Some(pty.clone());
                            }

                            let is_focused = match self.focus {
                                Focus::TerminalPane(focused_pane_idx) => {
                                    pane_idx == focused_pane_idx
                                }
                                _ => false,
                            };
                            let mut state = TerminalPaneState::default();

                            let terminal_pane = TerminalPane::new()
                                .task_name(task.name.clone())
                                .pty_data(&mut terminal_pane_data)
                                .focused(is_focused)
                                .continuous(task.continuous);

                            f.render_stateful_widget(terminal_pane, *chunk, &mut state);
                        }
                    } else {
                        let placeholder =
                            Paragraph::new("Press 1 or 2 on a task to show it here")
                                .block(
                                    Block::default()
                                        .title(format!("Output {}", pane_idx + 1))
                                        .borders(Borders::ALL)
                                        .border_style(Style::default().fg(Color::DarkGray)),
                                )
                                .style(Style::default().fg(Color::DarkGray))
                                .alignment(Alignment::Center);

                        f.render_widget(placeholder, *chunk);
                    }
                }
            }
        }
        Ok(())
    }
}
