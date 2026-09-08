import Image from "next/image";
import Link from "next/link";

import styles from "./home-add-button.module.css";

/** Figma 690:17474. The destination checks authentication before rendering. */
export function HomeAddButton() {
  return (
    <div className={styles.position}>
      <Link
        href="/create-event"
        className={styles.button}
        aria-label="Tədbir əlavə et"
      >
        <span aria-hidden="true" className={styles.gradient} />
        <Image
          src="/figma/home/add-square.svg"
          alt=""
          width={28}
          height={28}
          className={styles.icon}
        />
      </Link>
    </div>
  );
}
