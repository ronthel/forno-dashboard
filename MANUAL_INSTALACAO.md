# Manual de Instalação — Forno Dashboard

Este manual guia a instalação **do zero**, passo a passo, mesmo que você nunca tenha usado terminal antes. Funciona tanto num computador com **Linux** quanto com **Windows**. Siga na ordem — não pule etapas.

**Tempo estimado**: 15 a 30 minutos, dependendo da velocidade da internet.

Este é o projeto de **visualização** (Dashboard). Ele depende do
[Wtecc Historian](https://github.com/ronthel/wtecc-historian) já instalado
e rodando — **instale o Historian primeiro** e guarde os valores que aparecem
no final da instalação dele (você vai precisar deles aqui).

---

## Visão geral (como tudo se encaixa)

```
 Outro computador (ou este mesmo)          Este computador
 ┌──────────────────────┐                  ┌───────────────────────────┐
 │        Docker          │                  │           Docker           │
 │  ┌──────────────────┐ │                  │  ┌───────────────────────┐ │
 │  │                    │ │                  │  │                        │ │
 │  │   Wtecc Historian  │◄┼──────rede────────┼──┤   Forno Dashboard      │ │
 │  │ (coleta + cadastro)│ │                  │  │   (gráficos)            │ │
 │  └──────────────────┘ │                  │  └───────────────────────┘ │
 └──────────────────────┘                  └───────────────────────────┘
```

Você vai instalar **um programa (Docker)** que roda tudo isso sozinho, dentro do computador. Depois, acessa pelo navegador de qualquer computador da mesma rede.

---

## O que você vai precisar antes de começar

- [ ] Um computador com **Windows 10/11** OU **Ubuntu Linux** (22.04+), ligado na **mesma rede local** do servidor do Historian (pode ser este mesmo computador).
- [ ] Esse computador **ligado na internet** (só durante a instalação).
- [ ] O **Wtecc Historian já instalado**, com os 4 valores anotados no final da instalação dele: IP/porta do InfluxDB, IP/porta da API, `INFLUX_TOKEN` e a senha do papel `viewer`.
- [ ] Acesso ao computador (na frente dele, ou remotamente).

> 💡 Tudo que você precisa digitar está em caixas cinzas como esta:
> ```bash
> exemplo de comando
> ```
> Copie exatamente como está escrito.

---

## PARTE A — Preparando o ambiente

Escolha a seção conforme o seu sistema operacional. **A partir da Parte B, os passos são idênticos** nos dois casos.

### A.1 — Se o computador é LINUX (Ubuntu)

**1. Abra o terminal** — procure "Terminal" no menu de aplicativos, ou aperte `Ctrl+Alt+T`.

**2. Instale o Docker:**
```bash
wget -qO get-docker.sh https://get.docker.com
sudo sh get-docker.sh
```
Vai pedir sua senha do Ubuntu — digite e aperte Enter (a senha não aparece na tela, é normal).

> ⚠️ **Importante**: enquanto esse comando roda (alguns minutos), **não clique dentro da janela do terminal** nem selecione texto com o mouse — isso pode pausar o processo sem avisar. Só espere terminar sozinho.

```bash
sudo usermod -aG docker $USER
```

**Feche o terminal e abra um novo** (necessário pra esse último comando fazer efeito). Confirme:
```bash
docker --version
```

**3. Instale o Git:**
```bash
sudo apt update && sudo apt install -y git
```

Pronto — pule para a **Parte B**.

---

### A.2 — Se o computador é WINDOWS

No Windows, o Docker roda **dentro de um ambiente Linux integrado** (chamado WSL2), que o próprio instalador do Docker configura sozinho — você **não** vai instalar nem administrar um "Linux separado". Os containers e os dados ficam todos dentro do Docker Desktop.

> 💡 **Por que instalar o "Ubuntu" no passo 2, então?** Só porque o `install.sh` deste manual é um script em **bash** (a linguagem de terminal do Linux) e o PowerShell/CMD do Windows não entende bash. O app "Ubuntu" é apenas **um terminal** para digitar os comandos — ele compartilha o mesmo motor do Docker Desktop por baixo dos panos, é leve (poucas centenas de MB) e não exige nenhuma configuração além de abrir e usar.

**1. Baixe e instale o Docker Desktop:**
Acesse `https://www.docker.com/products/docker-desktop/` no navegador, baixe a versão Windows, e execute o instalador (próximo, próximo, concluir). Ele pode pedir pra **reiniciar o computador** — reinicie se pedir.

**2. Instale o "Ubuntu" (o terminal Linux que vamos usar):**
Abra a **Microsoft Store**, procure por **"Ubuntu"** e instale (é gratuito). Depois de instalar, abra pelo menu Iniciar — na primeira vez, ele pede pra criar um usuário e senha **desse Ubuntu** (pode ser qualquer um, é só local).

**3. Abra o Docker Desktop** (ele precisa estar aberto e rodando em segundo plano — ícone da baleia na bandeja do sistema, perto do relógio). Vá em **Settings → Resources → WSL Integration** e confirme que "Ubuntu" está marcado/habilitado (na maioria das instalações recentes, isso já vem ligado por padrão).

**4. A partir de agora, todo comando deste manual é digitado dentro do terminal "Ubuntu"** (não no PowerShell/CMD do Windows). Abra-o pelo menu Iniciar.

**5. Instale o Git** (dentro do terminal Ubuntu):
```bash
sudo apt update && sudo apt install -y git
```

> 📝 **Anote o IP do Windows agora** (vai precisar dele na Parte B): abra o **PowerShell normal do Windows** (não o Ubuntu) e rode:
> ```powershell
> ipconfig
> ```
> Procure por "Endereço IPv4" na sua rede (geralmente algo como `192.168.x.x`). **Anote esse número** — é diferente do IP que aparece dentro do Ubuntu.

Pronto — siga para a **Parte B**, sempre dentro do terminal **Ubuntu**.

---

## PARTE B — Instalação

#### Passo 1 — Baixar o programa

```bash
git clone git@github.com:ronthel/forno-dashboard.git
```

> Se aparecer erro de permissão/acesso negado, essa máquina ainda não tem autorização pra baixar do GitHub — peça pra quem te passou este manual configurar isso, ou te enviar os arquivos por outro meio (pendrive, por exemplo).

```bash
cd forno-dashboard
```

#### Passo 2 — Rodar a instalação

```bash
./install.sh
```

O script vai fazer perguntas:

| Pergunta | O que responder |
|---|---|
| IP desta máquina na rede local | **Linux**: aperte Enter pra aceitar o valor sugerido. **Windows**: digite o IP que você anotou no `ipconfig` (Parte A.2) — **não** aceite o valor sugerido automaticamente, ele estará errado. |
| IP do servidor do Historian | Se for este mesmo computador, aperte Enter. Se for outro servidor, digite o IP dele. |
| Porta do InfluxDB / Porta da API do Historian | Aperte Enter pra aceitar o padrão (`8181`/`8000`), a menos que a instalação do Historian tenha te informado portas diferentes. |
| `INFLUX_TOKEN` | Cole o valor anotado no final da instalação do Historian. |
| Senha do papel "viewer" | Cole o valor anotado no final da instalação do Historian. |

**Depois é só esperar** — pode levar alguns minutos na primeira vez (baixa vários programas da internet). Mensagens `==> Subindo...`, `==> Construindo...` são normais.

#### Passo 3 — Guardar as informações finais

Ao terminar, aparece um resumo com o endereço do dashboard:

```
  Dashboard:  http://192.168.1.60:3000
```

---

## PARTE C — Primeiro acesso

Abra um navegador (Chrome, Firefox) em **qualquer computador da mesma rede** e acesse o endereço do resumo.

**C.1** — Na primeira vez, crie um usuário — **o primeiro cadastro vira administrador automaticamente**.

**C.2 — Trazer as variáveis do Historian**: como administrador, vá em **Variáveis** (barra lateral) → **Nova** → busque a tag já cadastrada no Historian → preencha descrição/unidade/limites → **Salvar**. No dashboard principal, clique em **Adicionar** pra criar um gráfico.

**Pronto — sistema instalado e funcionando.**

---

## Problemas comuns

**"docker: comando não encontrado"** — Feche e abra o terminal de novo.

**O comando de instalação do Docker travou** — Você deve ter clicado dentro da janela sem querer. Feche, abra de novo, repita o comando (não duplica o que já foi instalado).

**"AVISO: não consegui confirmar a API do Historian"** — O `install.sh` continua mesmo assim, mas as telas de Variáveis/Perdas vão falhar até isso ser resolvido. Confirme: o Historian está rodando (`docker ps` na máquina dele)? O IP/portas digitados na instalação estão certos? Existe firewall bloqueando as portas 8000/8181 entre as duas máquinas?

**(Windows) Não consigo acessar pelo IP de outro computador** — Confirme que usou o IP do `ipconfig` do **Windows** (não o do Ubuntu) na pergunta de instalação. Se persistir, verifique o Firewall do Windows (pode estar bloqueando a porta 3000).

**Outro problema** — Contate o suporte técnico responsável por esta instalação.
