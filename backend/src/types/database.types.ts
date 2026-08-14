export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      analyzers: {
        Row: {
          asset_tag: string
          brand_model: string | null
          calibration_date: string | null
          calibration_due: string | null
          calibration_expiry: string | null
          category_id: number | null
          created_at: string
          current_location: string | null
          id: number
          name: string
          notes: string | null
          serial_number: string | null
          status: string
          type: string | null
        }
        Insert: {
          asset_tag: string
          brand_model?: string | null
          calibration_date?: string | null
          calibration_due?: string | null
          calibration_expiry?: string | null
          category_id?: number | null
          created_at?: string
          current_location?: string | null
          id?: number
          name: string
          notes?: string | null
          serial_number?: string | null
          status?: string
          type?: string | null
        }
        Update: {
          asset_tag?: string
          brand_model?: string | null
          calibration_date?: string | null
          calibration_due?: string | null
          calibration_expiry?: string | null
          category_id?: number | null
          created_at?: string
          current_location?: string | null
          id?: number
          name?: string
          notes?: string | null
          serial_number?: string | null
          status?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analyzers_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "equipment_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_equipments: {
        Row: {
          appointment_id: number
          category_id: number | null
          created_at: string
          id: number
          model: string | null
          sector: string | null
          serial_number: string | null
          tag: string | null
        }
        Insert: {
          appointment_id: number
          category_id?: number | null
          created_at?: string
          id?: number
          model?: string | null
          sector?: string | null
          serial_number?: string | null
          tag?: string | null
        }
        Update: {
          appointment_id?: number
          category_id?: number | null
          created_at?: string
          id?: number
          model?: string | null
          sector?: string | null
          serial_number?: string | null
          tag?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_equipments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_equipments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "equipment_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_technicians: {
        Row: {
          appointment_id: number
          created_at: string
          technician_id: number
        }
        Insert: {
          appointment_id: number
          created_at?: string
          technician_id: number
        }
        Update: {
          appointment_id?: number
          created_at?: string
          technician_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "appointment_technicians_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_technicians_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_date: string | null
          appointment_time: string | null
          client_address: string | null
          client_contact: string | null
          client_name: string | null
          created_at: string
          external_id: string | null
          id: number
          status: string
          technician_id: number | null
          technician_names: string | null
          title: string
        }
        Insert: {
          appointment_date?: string | null
          appointment_time?: string | null
          client_address?: string | null
          client_contact?: string | null
          client_name?: string | null
          created_at?: string
          external_id?: string | null
          id?: number
          status?: string
          technician_id?: number | null
          technician_names?: string | null
          title: string
        }
        Update: {
          appointment_date?: string | null
          appointment_time?: string | null
          client_address?: string | null
          client_contact?: string | null
          client_name?: string | null
          created_at?: string
          external_id?: string | null
          id?: number
          status?: string
          technician_id?: number | null
          technician_names?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_categories: {
        Row: {
          created_at: string
          description: string | null
          id: number
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: number
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: number
          name?: string
        }
        Relationships: []
      }
      notification_logs: {
        Row: {
          appointment_id: number | null
          id: number
          message: string | null
          sent_at: string
          status: string | null
          technician_id: number | null
          type: string | null
        }
        Insert: {
          appointment_id?: number | null
          id?: number
          message?: string | null
          sent_at?: string
          status?: string | null
          technician_id?: number | null
          type?: string | null
        }
        Update: {
          appointment_id?: number | null
          id?: number
          message?: string | null
          sent_at?: string
          status?: string | null
          technician_id?: number | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_logs_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          analyzer_id: number | null
          appointment_id: number | null
          checkin_at: string | null
          checkin_date: string | null
          checkout_at: string | null
          checkout_date: string | null
          created_at: string
          id: number
          notes: string | null
          reserved_date: string | null
          status: string
          technician_id: number | null
        }
        Insert: {
          analyzer_id?: number | null
          appointment_id?: number | null
          checkin_at?: string | null
          checkin_date?: string | null
          checkout_at?: string | null
          checkout_date?: string | null
          created_at?: string
          id?: number
          notes?: string | null
          reserved_date?: string | null
          status?: string
          technician_id?: number | null
        }
        Update: {
          analyzer_id?: number | null
          appointment_id?: number | null
          checkin_at?: string | null
          checkin_date?: string | null
          checkout_at?: string | null
          checkout_date?: string | null
          created_at?: string
          id?: number
          notes?: string | null
          reserved_date?: string | null
          status?: string
          technician_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_analyzer_id_fkey"
            columns: ["analyzer_id"]
            isOneToOne: false
            referencedRelation: "analyzers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
        ]
      }
      technicians: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          id: number
          name: string
          phone: string | null
          role: string
          status: string
          telegram_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: number
          name: string
          phone?: string | null
          role?: string
          status?: string
          telegram_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: number
          name?: string
          phone?: string | null
          role?: string
          status?: string
          telegram_id?: string | null
        }
        Relationships: []
      }
      test_templates: {
        Row: {
          analyzer_type: string
          category_id: number
          created_at: string
          description: string | null
          id: number
          is_mandatory: number
          name: string
          required_parameters: Json
        }
        Insert: {
          analyzer_type?: string
          category_id: number
          created_at?: string
          description?: string | null
          id?: number
          is_mandatory?: number
          name?: string
          required_parameters?: Json
        }
        Update: {
          analyzer_type?: string
          category_id?: number
          created_at?: string
          description?: string | null
          id?: number
          is_mandatory?: number
          name?: string
          required_parameters?: Json
        }
        Relationships: [
          {
            foreignKeyName: "test_templates_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "equipment_categories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never
