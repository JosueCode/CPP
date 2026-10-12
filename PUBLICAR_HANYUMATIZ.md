# HanYuMatiz: publicación conectada gratuita

El código para desplegar está en `HanYuMatiz_App`. El Blueprint `render.yaml` de esta rama utiliza un servicio web Render Free y una base externa Neon Free. Esta rama prepara la publicación; todavía no existe un servicio público creado.

1. Crea tus cuentas gratuitas de [Render](https://dashboard.render.com/register) y [Neon](https://console.neon.tech).
2. Crea una base dedicada en Neon Free. Importa el catálogo y prepara un rol limitado siguiendo [la guía](HanYuMatiz_App/docs/DEPLOY_GRATIS_RENDER_NEON.md).
3. En Render conecta este repositorio y selecciona la rama `hanyumatiz-publicacion-gratis` al crear el Blueprint. Introduce la conexión privada del rol limitado.
4. Usa la dirección HTTPS gratuita de Render y comprueba lecciones, dictado y reportes privados.

No necesitas comprar un dominio. Los planes gratuitos tienen cuotas y pueden suspenderse por inactividad. La configuración declara únicamente `plan: free`, sin base de pago de Render ni disco. Las conexiones y claves se configuran en los paneles privados; no forman parte del código público.
