import {
    AlertCircle,
    AlertTriangle,
    BarChart3,
    Bell,
    Calendar,
    Camera,
    CheckSquare,
    ChevronDown,
    ChevronRight,
    Clock,
    Diamond,
    DollarSign,
    Facebook,
    FileText,
    Folder,
    Globe,
    Headphones,
    Home,
    Image as ImageIcon,
    Inbox,
    ListChecks,
    Megaphone,
    MessageCircle,
    Package,
    Plus,
    RotateCcw,
    Search,
    Settings,
    ShoppingCart,
    Sparkles,
    StickyNote,
    TrendingUp,
} from "lucide-react";
import type { LucideProps } from "lucide-react";

const iconMap = {
    AlertCircle,
    AlertTriangle,
    BarChart3,
    Bell,
    Calendar,
    Camera,
    CheckSquare,
    ChevronDown,
    ChevronRight,
    Clock,
    Diamond,
    DollarSign,
    Facebook,
    FileText,
    Folder,
    Globe,
    Headphones,
    Home,
    Image: ImageIcon,
    Inbox,
    ListChecks,
    Megaphone,
    MessageCircle,
    Package,
    Plus,
    RotateCcw,
    Search,
    Settings,
    ShoppingCart,
    Sparkles,
    StickyNote,
    TrendingUp,
} as const;

export type IconName = keyof typeof iconMap;

interface DynamicIconProps extends LucideProps {
    name: string;
}

export const DynamicIcon = ({ name, ...props }: DynamicIconProps) => {
    const Icon = (iconMap as Record<string, typeof Home>)[name];
    if (!Icon) {
        return <Folder {...props} />;
    }
    return <Icon {...props} />;
};
