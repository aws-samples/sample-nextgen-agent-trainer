import disclaimer from './disclaimer.json';

interface Props {
  onAgree: () => void;
  onDisagree: () => void;
}

const d = disclaimer.privacyModal;

export function PrivacyModal({ onAgree, onDisagree }: Props) {
  return (
    <div className="privacy-overlay">
      <div className="privacy-modal">
        <h2 className="privacy-title">{d.title}</h2>

        <p className="privacy-text">
          {d.mandatory.split('<0>')[0]}
          <a href={d.mandatoryLink} target="_blank" rel="noreferrer">
            {d.mandatory.match(/<0>(.*?)<\/0>/)?.[1]}
          </a>
        </p>

        <hr className="privacy-divider" />

        <p className="privacy-text">
          {d.description.split('<0>')[0]}
          <a href={d.descriptionLink} target="_blank" rel="noreferrer">
            {d.description.match(/<0>(.*?)<\/0>/)?.[1]}
          </a>
        </p>

        <p className="privacy-text">
          {d.instruction}
        </p>

        <table className="privacy-table">
          <tbody>
            <tr>
              <td className="privacy-table-label">{d.collectedItemTitle}</td>
              <td>{d.collectedItemDesc}</td>
            </tr>
            <tr>
              <td className="privacy-table-label">{d.collectionUsePurposeTitle}</td>
              <td>{d.collectionUsePurposeDesc}</td>
            </tr>
            <tr>
              <td className="privacy-table-label">{d.retentionPeriodTitle}</td>
              <td>{d.retentionPeriodDesc}</td>
            </tr>
          </tbody>
        </table>

        <div className="privacy-actions">
          <button className="privacy-btn-disagree" onClick={onDisagree}>Disagree</button>
          <button className="privacy-btn-agree" onClick={onAgree}>Agree</button>
        </div>
      </div>
    </div>
  );
}
