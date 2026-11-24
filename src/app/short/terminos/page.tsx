import type { Metadata } from "next"

import {
  LegalEmail,
  LegalParagraph,
  LegalSection,
  LegalShell,
  LegalSubsection,
} from "@/components/short/legal-page"

/**
 * Términos y Condiciones de Uso (texto del dueño, assets/legaales.md, §2).
 * Página ESTÁTICA de contenido puro (prerenderizada en el build: cambiar el
 * texto exige rebuild). El copy legal es verbatim del documento: no se
 * reescribe.
 */
export const metadata: Metadata = {
  title: "Términos y Condiciones de Uso — SPEILink",
  description:
    "Reglas de uso de la plataforma SPEILink: naturaleza del servicio, vinculación con Mercado Pago, tarifas y responsabilidades.",
  icons: { icon: "/spei-link-favicon.ico" },
}

export default function TermsPage() {
  return (
    <LegalShell
      title="Términos y Condiciones de Uso"
      updated="SPEILink · Última actualización: Noviembre de 2026"
    >
      <LegalParagraph>
        Bienvenido a SPEILink (https://spei.link). Los presentes Términos y
        Condiciones regulan el acceso y uso de la plataforma tecnológica
        ofrecida por PeopleConnect (en adelante, &laquo;SPEILink&raquo;). Al
        registrarse o utilizar nuestros servicios, usted (en adelante, el
        &laquo;Usuario&raquo; o &laquo;Comercio&raquo;) acepta quedar sujeto a
        estos Términos.
      </LegalParagraph>

      <LegalSection title="1. Naturaleza del Servicio (Facilitador Tecnológico)" />
      <LegalSubsection title="1.1." />
      <LegalParagraph>
        SPEILink es exclusivamente una plataforma tecnológica de gestión,
        automatización de mensajería y conciliación informativa de cobros.
      </LegalParagraph>
      <LegalSubsection title="1.2." />
      <LegalParagraph>
        No somos una institución financiera: SPEILink no es un banco, ni una
        Institución de Fondos de Pago Electrónico (IFPE), ni un agregador de
        pagos, ni capta, custodia, administra, transmite o retiene recursos del
        público. SPEILink es un servicio independiente y no está afiliado,
        patrocinado ni operado por el Banco de México (Banxico) ni por Mercado
        Pago.
      </LegalParagraph>
      <LegalSubsection title="1.3." />
      <LegalParagraph>
        Flujo directo de los fondos: Todas las transferencias electrónicas
        (SPEI) realizadas por los clientes del Comercio se ejecutan de manera
        directa desde la institución bancaria del pagador hacia la cuenta
        digital de Mercado Pago titularidad del propio Comercio. SPEILink nunca
        toca ni tiene permisos para mover o disponer de dichos fondos.
      </LegalParagraph>

      <LegalSection title="2. Requisitos de Registro y Vinculación con Mercado Pago" />
      <LegalSubsection title="2.1." />
      <LegalParagraph>
        Para utilizar SPEILink, el Usuario debe ser mayor de edad, contar con
        capacidad legal para contratar y proporcionar información veraz durante
        su registro.
      </LegalParagraph>
      <LegalSubsection title="2.2. Conexión con Mercado Pago:" />
      <LegalParagraph>
        Para habilitar la validación automática de depósitos en tiempo real, el
        Usuario deberá vincular una cuenta activa de Mercado Pago (México)
        mediante los mecanismos oficiales de autorización (OAuth) con permisos
        estrictamente de solo lectura.
      </LegalParagraph>
      <LegalSubsection title="2.3." />
      <LegalParagraph>
        El Usuario es el único responsable de mantener la seguridad de sus
        credenciales de acceso a SPEILink, WhatsApp y Mercado Pago, así como de
        revocar la vinculación desde su panel si deja de utilizar el servicio.
      </LegalParagraph>

      <LegalSection title="3. Funcionamiento de Links, QR y Confirmación Automática" />
      <LegalSubsection title="3.1." />
      <LegalParagraph>
        El Usuario genera enlaces de pago o códigos QR especificando el monto y
        un concepto de pago único.
      </LegalParagraph>
      <LegalSubsection title="3.2." />
      <LegalParagraph>
        Cuando el comprador escanea el QR o abre el enlace, inicia una
        conversación de WhatsApp donde recibe las instrucciones de transferencia
        (CLABE y concepto).
      </LegalParagraph>
      <LegalSubsection title="3.3. Regla de validación:" />
      <LegalParagraph>
        SPEILink emitirá la confirmación automática en el chat de WhatsApp
        únicamente cuando reciba la notificación oficial de Mercado Pago
        acreditando que el depósito ingresó efectivamente a la cuenta del
        Usuario y coincide con el monto y/o concepto esperado. Si el depósito no
        se refleja o presenta inconsistencias, SPEILink no confirmará el pago.
      </LegalParagraph>

      <LegalSection title="4. Planes, Tarifas y Comisiones" />
      <LegalSubsection title="4.1. 0% de comisión por transacción:" />
      <LegalParagraph>
        SPEILink no cobra porcentajes ni comisiones por cada transferencia que
        el Usuario reciba en su cuenta.
      </LegalParagraph>
      <LegalSubsection title="4.2." />
      <LegalParagraph>
        El acceso a la plataforma se ofrece bajo un Plan Gratuito (sujeto a los
        límites de operaciones o funciones vigentes publicados en el sitio) y
        Planes Mensuales Fijos opcionales para comercios con mayor volumen
        operativo o necesidades avanzadas de seguimiento.
      </LegalParagraph>
      <LegalSubsection title="4.3." />
      <LegalParagraph>
        SPEILink se reserva el derecho de modificar los precios de los planes
        mensuales previa notificación al Usuario con al menos 15 días naturales
        de anticipación.
      </LegalParagraph>

      <LegalSection title="5. Uso Aceptable y Cumplimiento en WhatsApp" />
      <LegalSubsection title="5.1." />
      <LegalParagraph>
        El Usuario se obliga a utilizar SPEILink exclusivamente para actividades
        comerciales lícitas en los Estados Unidos Mexicanos. Queda estrictamente
        prohibido utilizar la plataforma para actividades ilícitas,
        fraudulentas, captación irregular de recursos o venta de bienes
        prohibidos por la ley.
      </LegalParagraph>
      <LegalSubsection title="5.2. Uso de contactos y mensajería:" />
      <LegalParagraph>
        El Usuario reconoce que obtiene el número de WhatsApp de sus clientes
        porque estos inician voluntariamente la conversación al pagar. El
        Usuario es el único responsable de cumplir con las Políticas de Comercio
        y Mensajería de WhatsApp (Meta) y la legislación mexicana de protección
        de datos al enviar mensajes de seguimiento o promociones posteriores,
        asumiendo cualquier sanción o bloqueo de línea derivado de envíos
        masivos no solicitados (spam).
      </LegalParagraph>

      <LegalSection title="6. Limitación de Responsabilidad y Disponibilidad" />
      <LegalSubsection title="6.1." />
      <LegalParagraph>
        SPEILink realiza esfuerzos razonables para mantener la plataforma
        disponible 24/7; sin embargo, la validación en tiempo real depende de la
        disponibilidad técnica de los servicios de terceros (red SPEI de
        Banxico, notificaciones webhook de Mercado Pago, servidores de
        WhatsApp/Meta y conexión a internet).
      </LegalParagraph>
      <LegalSubsection title="6.2." />
      <LegalParagraph>
        SPEILink no será responsable por retrasos en la acreditación de
        transferencias bancarias, intermitencias en los servidores de Mercado
        Pago o WhatsApp, ni por errores del pagador al capturar manualmente el
        monto o el concepto de referencia en su app bancaria.
      </LegalParagraph>
      <LegalSubsection title="6.3." />
      <LegalParagraph>
        El Usuario es el único responsable del cumplimiento de sus obligaciones
        fiscales (incluyendo la emisión de CFDI cuando corresponda) derivadas
        de las ventas cobradas a través de su cuenta.
      </LegalParagraph>

      <LegalSection title="7. Propiedad Intelectual" />
      <LegalParagraph>
        Todos los derechos sobre el software, diseño, código fuente, logotipos,
        interfaces, textos y marca SPEILink son propiedad exclusiva de su
        titular y están protegidos por la Ley Federal del Derecho de Autor y la
        Ley Federal de Protección a la Propiedad Industrial.
      </LegalParagraph>

      <LegalSection title="8. Suspensión y Terminación" />
      <LegalParagraph>
        El Usuario puede cancelar su cuenta en cualquier momento desde su panel
        o solicitándolo a soporte. SPEILink podrá suspender o cancelar sin
        previo aviso el acceso de cualquier Usuario que incumpla estos
        Términos, realice actividades sospechosas de fraude o comprometa la
        seguridad de la plataforma.
      </LegalParagraph>

      <LegalSection title="9. Legislación Aplicable y Jurisdicción" />
      <LegalParagraph>
        Para la interpretación, cumplimiento y ejecución de los presentes
        Términos y Condiciones, las partes se someten expresamente a las leyes
        federales aplicables en los Estados Unidos Mexicanos y a la
        jurisdicción de los tribunales competentes en la Ciudad de México,
        renunciando a cualquier otro fuero que pudiera corresponderles por
        razón de sus domicilios presentes o futuros.
      </LegalParagraph>
      <LegalParagraph>
        Contacto y Soporte: Para dudas sobre estos Términos, puede escribirnos
        a <LegalEmail email="soporte@spei.link" /> o a través de nuestro canal
        oficial de Soporte por WhatsApp en https://spei.link.
      </LegalParagraph>
    </LegalShell>
  )
}
