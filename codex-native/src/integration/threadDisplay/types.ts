export type ThreadEntryKind = "message" | "action";

export type ThreadActor = "user" | "assistant" | "system" | "tool" | "unknown";

export interface ThreadDisplayEntry {
  entry_id: string;
  turn_key: string;
  turn_id: string | null;
  role: ThreadActor;
  kind: ThreadEntryKind;
  text: string;
  created_at_utc: string | null;
  timestamp_label: string;
  timestamp_tooltip: string;
}

export interface PromptNavigationTarget {
  previous_turn_key: string | null;
  next_turn_key: string | null;
  user_turn_keys: string[];
}

export interface PromptJumpControls {
  placement: "left-of-send-voice";
  up_turn_key: string | null;
  down_turn_key: string | null;
  can_jump_up: boolean;
  can_jump_down: boolean;
  up_action: "jump-prev-user-message";
  down_action: "jump-next-user-message";
}

export interface ThreadVirtualWindow {
  start_index: number;
  end_index_exclusive: number;
  top_spacer_px: number;
  bottom_spacer_px: number;
  estimated_total_height_px: number;
}

export interface ThreadViewportState {
  scroll_top_px: number;
  scroll_height_px: number;
  viewport_height_px: number;
}

export interface ThreadScrollDecision {
  mode: "stick-to-bottom" | "preserve-offset" | "jump-to-turn" | "no-op";
  scroll_top_px?: number;
  delta_px?: number;
  turn_key?: string;
  behavior?: "auto" | "smooth";
}

export interface BuildThreadDisplayOptions {
  thread: unknown;
  current_turn_key?: string | null;
  focus_turn_key?: string | null;
  generated_at_utc?: string | null;
  viewport?: ThreadViewportState;
  previous_viewport?: ThreadViewportState;
  previous_entry_count?: number;
  measured_heights_px?: Readonly<Record<string, number>>;
  default_row_height_px?: number;
}

export interface ThreadDisplaySnapshot {
  integration_mode: "codex-native-host";
  generated_at_utc: string;
  entries: ThreadDisplayEntry[];
  prompt_navigation: PromptNavigationTarget;
  jump_controls: PromptJumpControls;
  virtual_window: ThreadVirtualWindow;
  scroll_decision: ThreadScrollDecision;
}
