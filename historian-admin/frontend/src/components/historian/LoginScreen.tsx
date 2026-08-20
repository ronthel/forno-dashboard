import { useState } from "react";
import { useAuth, type Role } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ROLE_LABELS: Record<Role, string> = {
  viewer: "Visualizador",
  operator: "Operador",
  admin: "Administrador",
};

export function LoginScreen() {
  const { login } = useAuth();
  const [role, setRole] = useState<Role>("viewer");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(role, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao entrar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <img src="/logo-wtecc.png" alt="WTECC Automação" className="h-12 w-auto" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">Wtecc Historian</h1>
            <p className="text-sm text-muted-foreground">Entre para continuar</p>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label>Papel</Label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="login-password">Senha</Label>
          <Input
            id="login-password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={200}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" className="w-full" disabled={loading || !password}>
          {loading ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </div>
  );
}
