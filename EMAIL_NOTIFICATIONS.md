# Avisos por e-mail

O cadastro oferece um opt-in opcional. A preferência e os registros de concessão/revogação ficam em `usuarios_private/{uid}.email_notifications`; os avisos nunca são enviados a quem não autorizou, está sem e-mail verificado ou desativou a opção no perfil.

Eventos implementados:

- desafio individual de ginásio recebido pelo líder;
- início de uma disputa de ginásio, para participantes ainda ativos;
- partida criada em uma rodada do campeonato Great Plateau, para os dois jogadores (exceto bye);
- insígnia criada e confirmada no Firestore, incluindo o troféu do Great Plateau.

## Configuração do provedor

O backend envia por Resend. Antes de publicar as Cloud Functions:

1. Crie/configure uma conta Resend e valide o domínio remetente.
2. Cadastre `RESEND_API_KEY` como secret do Firebase Functions: `firebase functions:secrets:set RESEND_API_KEY`.
3. Configure `MAIL_FROM` com o remetente validado no Resend, por exemplo `Liga Pokémon GO <avisos@seudominio.com>`.
4. Configure `PUBLIC_SITE_URL` com a URL pública do site, por exemplo `https://pokemon-go-liga.vercel.app`.
5. Publique as funções do codebase `default` no projeto Firebase correto.

`RESEND_API_KEY` é segredo e não deve ser colocado no código, no Vercel ou em variáveis `NEXT_PUBLIC_*`. `MAIL_FROM` e `PUBLIC_SITE_URL` podem ser definidos no arquivo de ambiente do codebase `functions` (não versionado) ou na configuração de ambiente suportada pelo deploy. O Resend precisa aceitar o domínio de `MAIL_FROM`; sem isso, os eventos falham e serão repetidos pelo mecanismo de retry do Firebase.

Depois de publicar as funções, faça um teste real com uma conta verificada e a opção ativada. A preferência iniciada para contas antigas é desligada até que o próprio usuário a ative no perfil.
