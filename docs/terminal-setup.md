# Terminal Setup

Tau uses the [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) for reliable modifier key detection. Most modern terminals support this protocol, but some require configuration.

## Kitty

Work out of the box.

## Ghostty

Add to your Ghostty config (`~/.config/ghostty/config`):

```
keybind = alt+backspace=text:\x1b\x7f
```

Older Claude Code versions may have added this Ghostty mapping:

```
keybind = shift+enter=text:\n
```

That mapping sends a raw linefeed byte. Inside tau, that is indistinguishable from `Ctrl+J`, so tmux and tau no longer see a real `shift+enter` key event.

If Claude Code 2.x or newer is the only reason you added that mapping, you can remove it, unless you want to use Claude Code in tmux, where it still requires that Ghostty mapping.

If you want `Shift+Enter` to keep working in tmux via that remap, add `ctrl+j` to your tau `newLine` keybinding in `~/.tau/agent/keybindings.json`:

```json
{
  "newLine": ["shift+enter", "ctrl+j"]
}
```

## WezTerm

WezTerm usually works out of the box for `Shift+Enter` via xterm modifyOtherKeys. To use the Kitty keyboard protocol explicitly, create `~/.wezterm.lua`:

```lua
local wezterm = require 'wezterm'
local config = wezterm.config_builder()
config.enable_kitty_keyboard = true
return config
```

## Alacritty

Alacritty usually works out of the box for `Shift+Enter`. To use `Alt+Enter` for tau follow-up queueing, add to `~/.config/alacritty/alacritty.toml`:

```toml
[[keyboard.bindings]]
key = "Enter"
mods = "Alt"
chars = "\u001b[13;3u"
```

Restart Alacritty after changing the config.

## VS Code (Integrated Terminal)

VS Code 1.109.5 and newer enable Kitty keyboard protocol in the integrated terminal by default, so `Shift+Enter` should work out of the box.

VS Code versions older than 1.109.5 need an explicit terminal keybinding for `Shift+Enter`.

`keybindings.json` locations:
- Linux: `~/.config/Code/User/keybindings.json`

Add to `keybindings.json`:

```json
{
  "key": "shift+enter",
  "command": "workbench.action.terminal.sendSequence",
  "args": { "text": "\u001b[13;2u" },
  "when": "terminalFocus"
}
```

## xfce4-terminal, terminator

These terminals have limited escape sequence support. Modified Enter keys like `Ctrl+Enter` and `Shift+Enter` cannot be distinguished from plain `Enter`, preventing custom keybindings such as `submit: ["ctrl+enter"]` from working.

For the best experience, use a terminal that supports the Kitty keyboard protocol:
- [Kitty](https://sw.kovidgoyal.net/kitty/)
- [Ghostty](https://ghostty.org/)
- [WezTerm](https://wezfurlong.org/wezterm/)
- [Alacritty](https://github.com/alacritty/alacritty) (requires compilation with Kitty protocol support)

## IntelliJ IDEA (Integrated Terminal)

The built-in terminal has limited escape sequence support. Shift+Enter cannot be distinguished from Enter in IntelliJ's terminal.

If you want the hardware cursor visible, set `TAU_HARDWARE_CURSOR=1` before running tau (disabled by default for compatibility).

Consider using a dedicated terminal emulator for the best experience.
