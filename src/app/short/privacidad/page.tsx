import type { Metadata } from "next"

import {
  LegalEmail,
  LegalList,
  LegalNote,
  LegalOrderedList,
  LegalParagraph,
  LegalSection,
  LegalShell,
  LegalSubsection,
} from "@/components/short/legal-page"

/**
 * Aviso de Privacidad Integral (texto del dueño, assets/legaales.md, §1).
 * Página ESTÁTICA de contenido puro (prerenderizada en el build: cambiar el
 * texto exige rebuild). El copy legal es verbatim del documento: no se
 * reescribe.
 */
export const metadata: Metadata = {
  title: "Aviso de Privacidad — SPEILink",
  description:
    "Cómo SPEILink recaba, usa y protege los datos personales de comercios y pagadores.",
  icons: { icon: "/spei-link-favicon.ico" },
}

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Aviso de Privacidad Integral"
      updated="SPEILink · Última actualización: Noviembre de 2026"
    >
      <LegalParagraph>
        PeopleConnect, operando comercialmente bajo la marca SPEILink (en lo
        sucesivo, &laquo;SPEILink&raquo;), con domicilio para oír y recibir
        notificaciones en Vasco de Quiroga 1574, Santa Fe, Álvaro Obregón,
        01210, Ciudad de México, México y portal de internet https://spei.link,
        es el responsable del uso, tratamiento y protección de los datos
        personales que recaba a través de su plataforma tecnológica.
      </LegalParagraph>

      <LegalSection title="1. Datos personales que recabamos" />
      <LegalParagraph>
        Para cumplir con las finalidades descritas en el presente Aviso de
        Privacidad, recabaremos las siguientes categorías de datos personales:
      </LegalParagraph>
      <LegalList
        items={[
          <>
            <strong>Datos de identificación y contacto del Comercio (Usuario):</strong>{" "}
            Nombre completo o denominación social, nombre comercial del negocio,
            número de teléfono móvil (WhatsApp) y correo electrónico.
          </>,
          <>
            <strong>Datos de vinculación tecnológica y transaccional (Solo lectura):</strong>{" "}
            Identificador de usuario y tokens de autorización de solo lectura
            otorgados mediante el protocolo OAuth de Mercado Pago, cuenta CLABE
            receptora del Comercio, montos, conceptos de pago, fechas, horas y
            estatus de confirmación de transferencias electrónicas (SPEI).
          </>,
          <>
            <strong>Datos de contacto de los Pagadores (Clientes finales del Comercio):</strong>{" "}
            Número telefónico de WhatsApp y nombre de perfil público que el
            Pagador comparte voluntariamente al iniciar la conversación para
            solicitar o confirmar un cobro, así como los datos contenidos en la
            notificación de depósito entrante.
          </>,
        ]}
      />
      <LegalNote>
        Importante: SPEILink NO recaba ni almacena contraseñas bancarias,
        números de tarjetas de crédito o débito, códigos CVV ni credenciales de
        acceso directo a la banca electrónica de los Usuarios o Pagadores.
      </LegalNote>

      <LegalSection title="2. Finalidades del tratamiento de datos" />
      <LegalSubsection title="A. Finalidades Primarias (Necesarias para el servicio):" />
      <LegalOrderedList
        items={[
          "Crear, administrar y autenticar la cuenta del Comercio dentro de la plataforma SPEILink.",
          "Generar enlaces de cobro y códigos QR personalizados asociados a la cuenta receptora del Comercio.",
          "Consultar en tiempo real, mediante permisos de solo lectura autorizados por el Comercio en Mercado Pago, la recepción de depósitos por transferencia electrónica que coincidan con los conceptos de pago generados.",
          "Enviar notificaciones y comprobantes digitales automatizados vía WhatsApp tanto al Comercio como al Pagador que inició la conversación.",
          "Mantener un historial y panel de conciliación de ventas para consulta del Comercio.",
          "Brindar soporte técnico y atención a clientes a través de WhatsApp o correo electrónico.",
        ]}
      />
      <LegalSubsection title="B. Finalidades Secundarias (Opcionales):" />
      <LegalOrderedList
        items={[
          "Enviar comunicaciones sobre nuevas funcionalidades, actualizaciones del servicio, guías de uso o planes comerciales de SPEILink.",
          "Realizar análisis estadísticos internos y métricas de rendimiento de forma disociada (anonimizada) para mejorar la plataforma.",
        ]}
      />
      <LegalParagraph>
        Si no desea que sus datos personales sean tratados para estas
        finalidades secundarias, puede manifestarlo enviando un correo a{" "}
        <LegalEmail email="privacidad@spei.link" /> con el asunto &laquo;Negativa
        a finalidades secundarias&raquo;.
      </LegalParagraph>

      <LegalSection title="3. Transferencia de datos personales" />
      <LegalParagraph>
        SPEILink no vende, alquila ni comercializa sus datos personales a
        terceros. Sus datos únicamente podrán ser compartidos o procesados a
        través de proveedores de infraestructura tecnológica indispensables
        para la operación del servicio (servicios de alojamiento en la nube,
        API oficial de WhatsApp Business / Meta Platforms y pasarela de
        autorización de Mercado Pago), quienes operan bajo estrictos estándares
        de seguridad y confidencialidad, así como ante autoridades competentes
        cuando medie requerimiento legal fundado y motivado conforme a la
        LFPDPPP.
      </LegalParagraph>

      <LegalSection title="4. Responsabilidad del Comercio respecto a los datos de sus clientes" />
      <LegalParagraph>
        Cuando un Pagador escanea un código QR o abre un enlace de SPEILink,
        inicia de manera directa una conversación de WhatsApp con el Comercio.
        El Comercio reconoce que se constituye como Responsable independiente
        respecto al uso posterior que decida dar al número telefónico de sus
        clientes (por ejemplo, seguimiento postventa, envío de garantías o
        campañas promocionales), obligándose a cumplir con la LFPDPPP y las
        políticas de comercio y mensajería de WhatsApp Business.
      </LegalParagraph>

      <LegalSection title="5. Derechos ARCO y revocación del consentimiento" />
      <LegalParagraph>
        Usted tiene derecho a conocer qué datos personales tenemos de usted,
        para qué los utilizamos y las condiciones del uso que les damos
        (Acceso); solicitar la corrección de su información personal
        (Rectificación); que la eliminemos de nuestros registros (Cancelación);
        así como oponerse al uso de sus datos para fines específicos
        (Oposición), o revocar el consentimiento otorgado (incluyendo la
        desvinculación inmediata de su cuenta de Mercado Pago).
      </LegalParagraph>
      <LegalParagraph>
        Para ejercer cualquiera de los derechos ARCO, envíe una solicitud al
        correo electrónico <LegalEmail email="privacidad@spei.link" /> indicando:
        (i) nombre completo del titular y correo o WhatsApp registrado; (ii)
        copia de identificación oficial vigente para acreditar su identidad;
        (iii) descripción clara de los datos sobre los que busca ejercer algún
        derecho; y (iv) cualquier elemento que facilite su localización.
        Responderemos en un plazo máximo de 20 días hábiles.
      </LegalParagraph>

      <LegalSection title="6. Uso de tecnologías de rastreo (Cookies)" />
      <LegalParagraph>
        Nuestro sitio web utiliza cookies y tecnologías esenciales de sesión
        para mantener la seguridad, recordar sus preferencias y analizar el
        tráfico de navegación. Puede deshabilitarlas desde la configuración de
        su navegador, aunque ello podría afectar ciertas funciones del panel.
      </LegalParagraph>

      <LegalSection title="7. Cambios al Aviso de Privacidad" />
      <LegalParagraph>
        Nos reservamos el derecho de efectuar modificaciones o actualizaciones
        al presente Aviso de Privacidad. Cualquier cambio estará disponible
        para su consulta permanente en spei.link.
      </LegalParagraph>
    </LegalShell>
  )
}
