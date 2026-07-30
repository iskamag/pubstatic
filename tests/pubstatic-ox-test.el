;;; pubstatic-ox-test.el --- Tests for Pubstatic's Org export hook -*- lexical-binding: t; -*-

(require 'ert)
(require 'ox-html)
(load-file (expand-file-name "../scripts/pubstatic-ox.el"
                              (file-name-directory load-file-name)))

(ert-deftest pubstatic-ox-copies-attachments-for-a-subpath-blog ()
  "A copied attachment uses BLOG_PATH rather than a root-relative static URL."
  (let* ((root (make-temp-file "pubstatic-ox-" t))
         (public (expand-file-name "public" root))
         (org-file (expand-file-name "night-sky.org" root))
         (output (expand-file-name "content/posts/night-sky.html" root))
         (image (expand-file-name "images/stars.png" root))
         (pubstatic-attachments-directory public)
         (pubstatic-blog-path "/posts"))
    (unwind-protect
        (progn
          (make-directory (file-name-directory image) t)
          (make-directory (file-name-directory output) t)
          (with-temp-file image (insert "not-a-real-png"))
          (with-temp-file org-file
            (insert "#+TITLE: Night sky\n"
                    "#+PUBSTATIC_ATTACHMENTS: copy\n\n"
                    "[[file:images/stars.png][Stars]]\n"))
          (with-current-buffer (find-file-noselect org-file)
            (unwind-protect
                (progn
                  (pubstatic-ox-setup)
                  (org-export-to-file 'html output nil nil nil t)
                  (let ((html (with-temp-buffer
                                (insert-file-contents output)
                                (buffer-string))))
                    (should (string-match-p
                             "src=\"/posts/static/uploads/night-sky/images/stars.png\""
                             html))
                    (should-not (string-match-p "href=\"images/stars.png\"" html))
                    (should (file-exists-p
                             (expand-file-name "uploads/night-sky/images/stars.png" public)))))
              (kill-buffer (current-buffer))))
      (delete-directory root t)))))

(ert-run-tests-batch-and-exit)

;;; pubstatic-ox-test.el ends here
