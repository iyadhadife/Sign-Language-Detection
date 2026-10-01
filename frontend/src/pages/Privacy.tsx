import { PageHeader } from "../components/ui";

export default function Privacy() {
  return (
    <div className="page narrow">
      <PageHeader eyebrow="About" title="Privacy Policy" subtitle="Last updated: 11/06/2024" />
      <article className="prose card">
        <p>
          At SignIA, we take the confidentiality of your personal data very seriously. This privacy policy explains how we collect,
          use, share and protect information about you when you use our website, which translates sign language using artificial
          intelligence (AI). We are committed to complying with the European Union's General Data Protection Regulation (GDPR).
        </p>

        <h2>1. Information we collect</h2>
        <h3>1.1 Information collected</h3>
        <p>
          <strong>Personal data:</strong> we may collect personally identifiable information such as your name, your email address and
          any other information you choose to provide.
        </p>
        <p>
          <strong>Technical data:</strong> we automatically collect technical information such as your IP address, browser type, the
          pages visited on our site and the time spent on our site.
        </p>
        <h3>1.2 Collection methods</h3>
        <p>
          <strong>Contact forms:</strong> when you fill in a contact form or register on our site.
        </p>
        <p>
          <strong>Cookies and similar technologies:</strong> to improve your experience on our site, we use cookies and other tracking
          technologies.
        </p>

        <h2>2. How we use information</h2>
        <p>We use the information collected to:</p>
        <ul>
          <li>
            <strong>Provide and improve our services:</strong> use the data to translate sign language and improve the AI.
          </li>
          <li>
            <strong>Communicate:</strong> send you updates and notifications and respond to your requests.
          </li>
          <li>
            <strong>Security:</strong> ensure the security and integrity of our site.
          </li>
        </ul>

        <h2>3. Sharing of information</h2>
        <p>We do not sell, trade or rent your personal information to third parties. We may share your information with:</p>
        <ul>
          <li>
            <strong>Trusted partners:</strong> third-party service providers who help us operate our site and provide our services,
            provided they agree to keep the information confidential.
          </li>
          <li>
            <strong>Legal obligations:</strong> if required by law or to protect our legal rights.
          </li>
        </ul>

        <h2>4. Data security</h2>
        <p>
          We take appropriate security measures to protect your personal information against unauthorised access, alteration,
          disclosure or destruction. This includes internal reviews of our data collection, storage and processing practices and of
          our security measures.
        </p>

        <h2>5. Your rights</h2>
        <p>Under the GDPR, you have the right to:</p>
        <ul>
          <li>
            <strong>Access your data:</strong> request a copy of the personal information we hold about you.
          </li>
          <li>
            <strong>Rectify your data:</strong> request the correction of any inaccurate or incomplete personal information.
          </li>
          <li>
            <strong>Erase your data:</strong> request the deletion of your personal data under certain conditions.
          </li>
          <li>
            <strong>Restrict processing:</strong> request that we limit the processing of your personal data in certain circumstances.
          </li>
          <li>
            <strong>Data portability:</strong> receive your personal information in a structured, commonly used format.
          </li>
          <li>
            <strong>Object:</strong> object to the processing of your personal data in certain circumstances.
          </li>
        </ul>

        <h2>6. Data retention</h2>
        <p>
          We keep your personal information only as long as necessary to achieve the purposes described in this privacy policy,
          unless a longer retention period is required or permitted by law.
        </p>

        <h2>7. Changes to this policy</h2>
        <p>
          We may update this privacy policy from time to time. We will inform you of any changes by publishing the new policy on our
          website. We encourage you to check this page regularly to stay informed about our privacy practices.
        </p>

        <h2>8. Contact</h2>
        <p>If you have any questions about this privacy policy or our data processing practices, please contact us at:</p>
        <address>
          SignIA
          <br />
          12 avenue Léonard de Vinci, 92400 Courbevoie, France
          <br />
          contact@SignIA.fr
          <br />
          +33 6 00 00 00 00
        </address>
        <p>By using our website, you accept the terms of this privacy policy.</p>
      </article>
    </div>
  );
}
