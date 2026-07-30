export interface Scan {
  id: string;
  user_id: string;
  image_url: string;
  ocr_text: string;
  status: "processing" | "completed" | "failed";
  items_count: number;
  created_at: string;
  completed_at?: string;
  error_message?: string;
  agent_summary?: string;
  enriched?: boolean;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price?: number;
  category?: string;
  image_url: string;
  confidence: number;
  scan_id: string;
  created_at: string;
  dietary_tags?: string[];
  origin?: string;
  ai_description?: string;
}

export interface DishResult {
  id: string;
  name: string;
  description?: string;
  ai_description?: string;
  price?: number;
  category?: string;
  origin?: string;
  dietary_tags: string[];
  images: string[];
  confidence: number;
}
