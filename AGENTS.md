# Publicação e alterações de layout

- Publicar mudanças de layout somente após autorização explícita do usuário.
- O redesign do menu administrativo e do dashboard está reservado na branch local `codex/layout-admin-pendente`; não enviar essa branch nem incluir o redesign em `main` sem autorização.
- Há arquivos compartilhados entre funcionalidades e layout, especialmente `frontend/src/views.jsx` e `frontend/src/index.css`. Revisar e separar seus trechos antes de commit, push ou deploy.
- Estilos necessários a uma funcionalidade autorizada, como a exibição dos agendamentos, podem acompanhar essa funcionalidade; isso não autoriza publicar o redesign geral.
