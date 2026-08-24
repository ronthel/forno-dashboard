# Manual de Instalação — Forno Dashboard + Wtecc Historian

Este manual guia a instalação **do zero**, passo a passo, mesmo que você nunca tenha usado terminal antes. Funciona tanto num computador com **Linux** quanto com **Windows**. Siga na ordem — não pule etapas.

**Tempo estimado**: 30 a 60 minutos, dependendo da velocidade da internet.

---

## Visão geral (como tudo se encaixa)

```
 Seu computador (Windows ou Linux)
 ┌─────────────────────────────────────┐
 │              Docker                  │
 │  ┌───────────┐      ┌─────────────┐  │        ┌─────────┐
 │  │ Dashboard │      │  Historian  │◄─┼────────┤   CLP   │
 │  │  (gráficos)│      │(cadastro CLP)│  │        │(máquina)│
 │  └─────┬─────┘      └──────┬──────┘  │        └─────────┘
 │        │  Bancos de dados  │         │
 │        └─────────┬─────────┘         │
 └──────────────────┼───────────────────┘
                     │
              seu navegador
           (Chrome, Firefox...)
```

Você vai instalar **um programa (Docker)** que roda tudo isso sozinho, dentro do computador. Depois, acessa pelo navegador de qualquer computador da mesma rede.

---

## O que você vai precisar antes de começar

- [ ] Um computador com **Windows 10/11** OU **Ubuntu Linux** (22.04+), ligado na **mesma rede local** do CLP.
- [ ] Esse computador **ligado na internet** (só durante a instalação).
- [ ] O **endereço IP do CLP** — pergunte ao técnico de automação, se não souber.
- [ ] Saber o **fabricante do CLP**: Rockwell (Allen-Bradley), Siemens ou Schneider.
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

> 📝 **Anote o IP do Windows agora** (vai precisar dele no Passo 5 da Parte B): abra o **PowerShell normal do Windows** (não o Ubuntu) e rode:
> ```powershell
> ipconfig
> ```
> Procure por "Endereço IPv4" na sua rede (geralmente algo como `192.168.x.x`). **Anote esse número** — é diferente do IP que aparece dentro do Ubuntu.

Pronto — siga para a **Parte B**, sempre dentro do terminal **Ubuntu**.

---

## PARTE B — Instalação (igual para Windows e Linux)

Existem **duas formas** de instalar — escolha uma:

| | **B.1 — Do zero** | **B.2 — Por clonagem** |
|---|---|---|
| Quando usar | Primeira instalação, ou não tem uma instalação já validada pra copiar | Já existe uma instalação testada e funcionando, e você quer replicar ela num cliente novo |
| O que acontece | Baixa e constrói tudo do zero (precisa de internet boa) | Restaura um pacote pronto (código + imagens já testadas + estrutura dos bancos) — mais rápido e não depende de internet no site do cliente |
| Quem faz | Qualquer pessoa seguindo este manual | **Equipe técnica WTECC** prepara o pacote (B.2, passo 1); a instalação em si (passo 2) pode ser feita por qualquer pessoa, igual à B.1 |

Nos dois casos, o resultado final é o mesmo: uma instalação nova, com senhas próprias, banco vazio e pronta pra cadastrar o CLP do cliente — siga para a **Parte C** depois de qualquer uma das duas.

### B.1 — Do zero

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
| Nome do CLP | Um nome pra identificar, ex: `Forno01` (sem espaços) |
| IP do CLP | O endereço de rede do controlador, ex: `192.168.1.108` |
| Fabricante do CLP | `1` Rockwell · `2` Siemens · `3` Schneider |
| Slot / Rack | Aperte Enter pra aceitar o padrão, se não souber (o técnico de automação ajusta depois se precisar) |

**Depois é só esperar** — pode levar de 5 a 15 minutos na primeira vez (baixa vários programas da internet). Mensagens `==> Subindo...`, `==> Criando...` são normais.

#### Passo 3 — Guardar as informações finais

Ao terminar, aparece um resumo assim:

```
  Dashboard:         http://192.168.1.50:3000
  Historian (CLPs):  http://192.168.1.50:3001
                     admin    = xxXXxxXXxx
                     operator = xxXXxxXXxx
                     viewer   = xxXXxxXXxx
```

> 🔴 **MUITO IMPORTANTE**: tire uma foto da tela ou anote **agora**. Essas senhas **não aparecem de novo**. Guarde em local seguro.

---

### B.2 — Por clonagem

Essa opção parte de uma instalação **já validada e funcionando** (por exemplo, a primeira instalação, ou a de um cliente anterior) e usa ela como base pra criar uma nova, isolada — com código e imagens já testados, mas com **todas as senhas trocadas** e **sem nenhum dado do cliente anterior** (histórico, CLP cadastrado, usuários).

#### Passo 1 — Gerar o pacote (equipe técnica WTECC, na instalação de origem)

Dentro da instalação que já está funcionando:
```bash
cd ~/projects/forno-dashboard
./scripts/backup-instalacao.sh
```
Isso gera uma pasta `~/backup-forno-<data>-<hora>/` com o código, as imagens já testadas e os dados atuais.

> 🔴 **Esse pacote é confidencial** — contém as senhas atuais da instalação de origem (usadas só de passagem, pra autenticar a troca no passo seguinte). Transfira só por um canal seguro (rede local, pendrive) e apague de qualquer lugar temporário assim que a clonagem terminar.

#### Passo 2 — Instalar no computador do cliente

Depois de preparar o computador conforme a **Parte A**, e com o pacote do Passo 1 já transferido pra essa máquina:
```bash
./clonar-instalacao.sh /caminho/para/backup-forno-<data>-<hora>
```

O script vai pedir o **IP desta máquina** (mesma orientação da tabela do B.1) e os **dados do CLP** deste cliente (nome, IP, fabricante, slot/rack) — os mesmos campos do Passo 2 da instalação do zero.

Ele então restaura os dados, troca automaticamente todas as senhas e tokens, apaga o histórico e o CLP da instalação de origem, e cadastra o CLP novo. Ao final, aparece o mesmo tipo de resumo com as senhas — vale o mesmo aviso: **anote agora**.

> 💡 Como as imagens já vêm prontas no pacote, esse caminho **não depende de baixar nada da internet** durante a instalação — útil em locais com rede fraca ou restrita.

Depois de confirmar que tudo subiu certo, apague o pacote de backup dessa máquina também.

---

## PARTE C — Primeiro acesso

Abra um navegador (Chrome, Firefox) em **qualquer computador da mesma rede** e acesse os endereços do resumo.

**C.1 — Dashboard** (`:3000`): na primeira vez, crie um usuário — **o primeiro cadastro vira administrador automaticamente**.

**C.2 — Historian** (`:3001`): entre com papel **admin** e a senha do resumo. Em **CLPs**, confirme que o controlador aparece com bolinha **verde** (conectado).

**C.3 — Cadastrar as tags**: ainda no Historian, **Tags → Nova tag** → escolha o CLP → busque o nome da tag (peça a lista ao técnico de automação) → salve. Repita para cada variável.

**C.4 — Trazer pro Dashboard**: volte pro Dashboard como administrador, vá em **Variáveis** (barra lateral) → **Nova** → busque a tag cadastrada → preencha descrição/unidade/limites → **Salvar**. No dashboard principal, clique em **Adicionar** pra criar um gráfico.

**Pronto — sistema instalado e funcionando.**

---

## Problemas comuns

**"docker: comando não encontrado"** — Feche e abra o terminal de novo.

**O comando de instalação do Docker travou** — Você deve ter clicado dentro da janela sem querer. Feche, abra de novo, repita o comando (não duplica o que já foi instalado).

**CLP aparece "fora do ar" no Historian** — Confirme o IP do CLP com o técnico de automação, confirme que a máquina está na mesma rede (`ping <ip-do-clp>`, `Ctrl+C` pra parar), e no caso Siemens confirme o rack/slot.

**(Windows) Não consigo acessar pelo IP de outro computador** — Confirme que usou o IP do `ipconfig` do **Windows** (não o do Ubuntu) na pergunta de instalação. Se persistir, verifique o Firewall do Windows (pode estar bloqueando as portas 3000/3001).

**Esqueci uma senha do Historian** — Entre como `admin`, vá na tela de administração de usuários/papéis e troque — não precisa reinstalar.

**Outro problema** — Contate o suporte técnico responsável por esta instalação.
