import {
  Wrench, MessageCircleQuestion, GitBranch, ListChecks, HardDrive, Globe, FileSearch, Megaphone, Music, Search,
  Camera, Image as ImageIcon, Clapperboard, Mic, LayoutTemplate, Rocket, Share2, Cloud, Notebook,
} from "lucide-react";

const MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  wrench: Wrench, "message-circle-question": MessageCircleQuestion, "git-branch": GitBranch, "list-checks": ListChecks,
  "hard-drive": HardDrive, globe: Globe, "file-search": FileSearch, megaphone: Megaphone, music: Music, search: Search,
  instagram: Camera, image: ImageIcon, clapperboard: Clapperboard, mic: Mic, "layout-template": LayoutTemplate,
  rocket: Rocket, facebook: Share2, cloud: Cloud, notebook: Notebook,
};

export function ToolIcon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const C = MAP[name] ?? Wrench;
  return <C size={size} className={className} />;
}
