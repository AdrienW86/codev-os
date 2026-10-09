export type ClientInput = {
  name: string;
  company_name: string | null;
  activity: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  geographic_area: string | null;
  notes: string | null;
};

export type Client = ClientInput & { id: string; created_at: string; updated_at: string };
export type ClientField = keyof ClientInput;
export type ClientFormState = { errors?: Partial<Record<ClientField, string>>; values?: Partial<Record<ClientField, string>>; message?: string };

// Description locale de la table existante uniquement ; aucune migration.
export type Database = {
  public: {
    Tables: {
      clients: {
        Row: Client;
        Insert: ClientInput;
        Update: Partial<ClientInput>;
        Relationships: [];
      };
    };
    Views: { [key: string]: never };
    Functions: { [key: string]: never };
  };
};
