
export interface GameExecutable {
  is_launcher: boolean;
  name: string;
  os: string;
  arguments?: string;
  filename?: string;
  path?: string;
  segments?: number;
  is_running?: boolean;
  is_installed?: boolean;
}
export interface Game {
    uid?: string;
    id: string;
    name: string;
    executables: GameExecutable[];
    aliases?: string[];
    themes?: string[];
    is_running?: boolean;
    is_installed?: boolean;
    /** True when Discord registered at least one executable for this game. */
    launchable?: boolean;
    /** True for games added manually through the custom game form. */
    is_custom?: boolean;
}

export interface GameActionsProvider {
  canPlayGame: (game: Game | null) => boolean;
  isGameInstalled: (game: Game | null) => boolean;
  isExecutableRunning: (executable: GameExecutable) => boolean;
  isGameExecutableInstalled: (executable: GameExecutable) => boolean;
}