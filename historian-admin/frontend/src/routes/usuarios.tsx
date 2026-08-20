import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/historian/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { useAuth, type Role } from "@/lib/auth-store";

export const Route = createFileRoute("/usuarios")({
  head: () => ({
    meta: [{ title: "Usuários e senhas — Wtecc Historian" }],
  }),
  component: UsuariosPage,
});

const ROLE_LABELS: Record<Role, string> = {
  viewer: "Visualizador",
  operator: "Operador",
  admin: "Administrador",
};

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  viewer: "Só visualização — sem editar, habilitar ou criar nada.",
  operator: "Habilita/desabilita CLPs e tags, edita regra de gravação de tags existentes.",
  admin: "Acesso total — cria/edita/exclui CLPs e tags, e gerencia as senhas desta tela.",
};

function UsuariosPage() {
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const [changingRole, setChangingRole] = useState<Role | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: roles, isLoading } = useQuery({
    queryKey: ["auth-roles"],
    queryFn: () => api.listRoles(),
    enabled: hasRole("admin"),
  });

  if (!hasRole("admin")) {
    return (
      <AppShell title="Usuários & Senhas" subtitle="Gerenciamento de acesso.">
        <div className="panel flex flex-col items-center gap-3 p-10 text-center">
          <ShieldAlert className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Essa tela é exclusiva do papel Administrador.
          </p>
        </div>
      </AppShell>
    );
  }

  const openChange = (role: Role) => {
    setChangingRole(role);
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
  };

  const submit = async () => {
    if (!changingRole) return;
    if (newPassword.length < 6) {
      setError("Senha muito curta (mínimo 6 caracteres).");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.changeRolePassword(changingRole, newPassword);
      toast.success(`Senha de ${ROLE_LABELS[changingRole]} atualizada.`);
      setChangingRole(null);
      queryClient.invalidateQueries({ queryKey: ["auth-roles"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao trocar a senha");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell
      title="Usuários & Senhas"
      subtitle="3 papéis fixos, com senha compartilhada por papel — não é uma conta por pessoa."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {(["viewer", "operator", "admin"] as Role[]).map((role) => {
          const info = roles?.find((r) => r.role === role);
          return (
            <div key={role} className="panel flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <p className="font-medium">{ROLE_LABELS[role]}</p>
                {isLoading ? null : info?.has_password ? (
                  <Badge variant="secondary" className="text-[10px]">
                    senha definida
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-warn/40 text-[10px] text-warn">
                    sem senha
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
              {info?.updated_at && (
                <p className="text-[11px] text-muted-foreground">
                  Última troca: {new Date(info.updated_at).toLocaleString("pt-BR")}
                </p>
              )}
              <Button variant="outline" size="sm" onClick={() => openChange(role)} className="mt-auto">
                <KeyRound className="size-4" /> Trocar senha
              </Button>
            </div>
          );
        })}
      </div>

      <Dialog open={!!changingRole} onOpenChange={(o) => !o && setChangingRole(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Trocar senha — {changingRole ? ROLE_LABELS[changingRole] : ""}
            </DialogTitle>
            <DialogDescription>
              Isso substitui a senha atual desse papel na hora — quem estiver usando a senha
              antiga precisa entrar com a nova a partir de agora.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="new-password">Nova senha</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                maxLength={200}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="confirm-password">Confirma a senha</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                maxLength={200}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setChangingRole(null)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={saving || !newPassword || !confirmPassword}>
              {saving ? "Salvando…" : "Salvar nova senha"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
