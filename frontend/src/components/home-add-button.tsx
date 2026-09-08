import Image from "next/image";

import styles from "./home-add-button.module.css";

/** Figma 690:17474. Enable once the event-creation destination is approved. */
export function HomeAddButton({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className={styles.position}>
      <button
        type="button"
        className={styles.button}
        aria-label="Tədbir əlavə et"
        onClick={onAdd}
        disabled={!onAdd}
      >
        <span aria-hidden="true" className={styles.gradient} />
        <Image
          src="/figma/home/add-square.svg"
          alt=""
          width={28}
          height={28}
          className={styles.icon}
        />
      </button>
    </div>
  );
}
