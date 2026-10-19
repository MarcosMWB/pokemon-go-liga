# Notificações no site

Os avisos aparecem na caixa de entrada `/notificacoes` e não dependem de domínio, Resend ou chave de API. A preferência fica em `usuarios_private/{uid}.notifications`; o usuário pode ativar ou desativar o recebimento no próprio perfil.

As Cloud Functions criam avisos para desafios individuais recebidos, início de disputa de ginásio, partidas do campeonato Great Plateau e insígnias/troféus adicionados ao perfil. Cada aviso é gravado em `notificacoes/{uid}/itens/{id}` e os documentos são protegidos pelas regras do Firestore para que cada pessoa só leia e marque como lidos os próprios avisos.

Para novos cadastros, o recebimento vem ativado por padrão e pode ser desmarcado no formulário. Contas existentes ficam desativadas até ativarem a opção no perfil.
