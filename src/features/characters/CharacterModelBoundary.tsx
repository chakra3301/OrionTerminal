import { Component, type ReactNode } from "react";
import { toast } from "@/store/toastStore";

export class CharacterModelBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    toast.warning("Companion model unavailable · showing the core instead", {
      body: error.message.slice(0, 500),
    });
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
