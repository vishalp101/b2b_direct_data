import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import Sidebar from "../components/Sidebar";
import "../css/ProfileLookup.css";

const BulkLookup = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [bulkResults, setBulkResults] = useState([]);
  const [file, setFile] = useState(null);
  const [fileHistory, setFileHistory] = useState([]);
  const user = JSON.parse(sessionStorage.getItem("user"));
  const userEmail = user?.email || "Guest";
  const [statistics, setStatistics] = useState(() => {
    const allStats = JSON.parse(sessionStorage.getItem("statisticsData")) || {};
    return (
      allStats[userEmail] || {
        duplicateCount: 0,
        netNewCount: 0,
        newEnrichedCount: 0,
        creditUsed: 0,
        remainingCredits: 0,
        uploadedLinks: [],
      }
    );
  });
  const [linkCounts, setLinkCounts] = useState(null);
  const [confirmProcess, setConfirmProcess] = useState(false);
  // New state variables
  const [totalLinksInFile, setTotalLinksInFile] = useState(0);
  const [availableMobileLinksInFile, setAvailableMobileLinksInFile] = useState(0);

  useEffect(() => {
    if (!user) {
      window.location.href = "/login";
    } else {
      fetchUserCredits();
    }
  }, []);

  const fetchUserCredits = async () => {
    try {
      const response = await fetch(`http://localhost:3000/users/user`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user?.token}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch lookup credits");

      const data = await response.json();
      console.log("API Response:", data);
      // Debugging log

      // Ensure correct data structure
      let usersArray = data?.data || data?.users || data; // Handle different response structures

      if (!Array.isArray(usersArray)) {
        console.error(
          "Invalid API response: expected an array but got",
          usersArray
        );
        return;
      }

      const currentUser = usersArray.find((u) => u.userEmail === userEmail);
      if (currentUser) {
        setStatistics((prevState) => ({
          ...prevState,
          remainingCredits: currentUser.credits || 0,
        }));
      } else {
        console.warn("User not found in API response");
      }
    } catch (error) {
      console.error("Error fetching user credits:", error);
    }
  };

  const updateUserCredits = async (newCredits) => {
    try {
      await fetch(`http://localhost:3000/users/update-credits`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ userEmail, credits: newCredits }),
      });
    } catch (error) {
      console.error("Error updating user credits:", error);
    }
  };

  const handleFileUpload = async () => {
    if (!file) {
      alert("Please upload a file first.");
      return;
    }

    if (statistics.remainingCredits <= 0) {
      alert("You have no remaining credits. Please contact support.");
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const fileData = e.target.result;
        let links = [];

        try {
          if (file.name.endsWith(".csv")) {
            const parsedData = Papa.parse(fileData, { header: false }).data;
            // Flatten and filter out empty values
            links = parsedData
              .flat()
              .filter((value) => value)
              .map((link) => String(link).trim());
          } else if (file.name.endsWith(".xlsx")) {
            const workbook = XLSX.read(fileData, { type: "array" });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, {
              header: 1,
            });
            // Improved Excel extraction: Iterate through rows and columns
            for (const row of jsonData) {
              for (const cell of row) {
                if (cell && typeof cell === "string") {
                  links.push(cell.trim());
                }
              }
            }
          }
        } catch (parseError) {
          console.error("Error parsing file:", parseError);
          alert("Error parsing file. Please check the file format.");
          setIsLoading(false);
          return;
        }

        // Enhanced link validation
        const linkedinRegex =
          /^https?:\/\/(www\.)?linkedin\.com\/(in|pub|company)\/[\w-]+\/?/;
        const validLinks = links
          .filter(
            (link) => link && typeof link === "string" && link.trim() !== ""
          )
          .map((link) => link.trim())
          .filter((link) => linkedinRegex.test(link));

        if (validLinks.length === 0) {
          alert("No valid LinkedIn links found in the file.");
          return;
        }

        // 1. Count total links in the uploaded file
        setTotalLinksInFile(validLinks.length);

        setIsLoading(true);
        try {
          await saveLinksToDatabase(validLinks);
          await fetchLinkCounts();
          // After saving links, fetch the counts including available mobile
        } catch (error) {
          console.error("Error processing file:", error);
          alert("Error processing file. Please try again later.");
        } finally {
          setIsLoading(false);
        }
      };

      if (file.name.endsWith(".csv")) {
        reader.readAsText(file);
      } else if (file.name.endsWith(".xlsx")) {
        reader.readAsArrayBuffer(file);
      }
    } catch (error) {
      console.error("Error processing file:", error);
      alert("Error processing file. Please try again later.");
    }
  };

  const fetchLinkCounts = async () => {
    try {
      const response = await fetch(
        `http://localhost:3000/uploadedLinks/link-counts?userEmail=${userEmail}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch link counts");
      }
      const data = await response.json();
      // Destructure the data to match the controller's response structure
      const {
        total_uploaded_links,
        available_mobile_numbers,
        newLinksCount,
        duplicateLinksCount,
      } = data;
      // Update state with the destructured data
      setLinkCounts({
        totalUploadedLinks: total_uploaded_links,
        availableMobileNumbers: available_mobile_numbers,
        newLinksCount: newLinksCount,
        duplicateLinksCount: duplicateLinksCount,
      });

      // 2. Count available mobile links (from the database query)
      setAvailableMobileLinksInFile(available_mobile_numbers);
    } catch (error) {
      console.error("Error fetching link counts:", error);
      alert("Error fetching link counts. Please try again later.");
    }
  };

  const handleConfirmProcess = async () => {
    if (!linkCounts) return;
    setIsLoading(true);
    setConfirmProcess(true);
    try {
      const apiUrl = `http://localhost:3000/uploadedLinks/data`;
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error("Failed to fetch bulk data");

      const data = await response.json();
      if (data.data && data.data.length > 0) {
        const fetchedLinks = data.data.filter((item) => item !== null);
        const bulkData = fetchedLinks.map((result) => ({
          ID: result.id,
          Email: result.user_email,
          LinkedIn_Link: result.clean_linkedin_link,
          Mobile_1: result.mobile_number || "Not Available",
          Mobile_2: result.mobile_number_2 || "Not Available",
          Name: result.person_name || "Not Available",
          Location: result.person_location || "Not Available",
        }));

        setBulkResults(bulkData);
        await saveStatistics(file.name, fetchedLinks, fetchedLinks.length);
        await saveFileToDatabase(bulkData);

        const creditDeduction = fetchedLinks.length * 5;
        if (creditDeduction > 0) {
          const newCredits = Math.max(
            0,
            statistics.remainingCredits - creditDeduction
          );
          await updateUserCredits(newCredits);
        }

        alert("Bulk data fetched successfully and statistics saved!");
        await updateUploadedLinks();
      } else {
        alert("No data found for the provided LinkedIn URLs.");
      }
    } catch (error) {
      console.error("Error fetching bulk data:", error);
      alert("Error fetching bulk data. Please try again later.");
    } finally {
      setIsLoading(false);
      setConfirmProcess(false);
    }
  };

  const saveStatistics = async (filename, validLinks, linkUploadCount) => {
    const userStats =
      JSON.parse(sessionStorage.getItem("statisticsData")) || {};
    const userPreviousUploads = userStats[userEmail]?.uploadedLinks || [];

    const newLinks = validLinks.filter(
      (link) => !userPreviousUploads.includes(link)
    );
    const duplicateLinks = validLinks.filter((link) =>
      userPreviousUploads.includes(link)
    );
    const duplicateCount = statistics.duplicateCount + duplicateLinks.length;
    const netNewCount = statistics.netNewCount + newLinks.length;

    const creditUsed = linkUploadCount * 5;
    const remainingCredits = Math.max(
      0,
      statistics.remainingCredits - creditUsed
    );
    const updatedStatistics = {
      task: "Bulk Lookup",
      email: userEmail,
      filename,
      duplicateCount,
      netNewCount,
      newEnrichedCount: statistics.newEnrichedCount || 0,
      creditUsed,
      remainingCredits,
      uploadedLinks: [...userPreviousUploads, ...newLinks],
      linkUpload: linkUploadCount, // Store the count here
    };
    userStats[userEmail] = updatedStatistics;
    sessionStorage.setItem("statisticsData", JSON.stringify(userStats));

    setStatistics(updatedStatistics);

    try {
      const response = await fetch("http://localhost:3000/bulkUpload/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedStatistics),
      });
      if (!response.ok)
        throw new Error(`Error saving statistics: ${response.statusText}`);
      alert("Statistics saved successfully!");
    } catch (error) {
      console.error("Error saving statistics:", error);
      alert(`Error saving statistics: ${error.message}`);
    }
  };

  const handleDownloadExcel = () => {
    if (bulkResults.length === 0) {
      alert("No bulk data available to download.");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(bulkResults);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Bulk Data Results");

    XLSX.writeFile(workbook, "Bulk_Data_Results.xlsx");
  };

  const fetchFileHistory = async () => {
    try {
      const response = await fetch(
        `http://localhost:3000/excel/history/${userEmail}`
      );
      if (!response.ok) throw new Error("Failed to fetch file history");

      const data = await response.json();
      setFileHistory(data);
    } catch (error) {
      console.error("Error fetching file history:", error);
    }
  };

  useEffect(() => {
    fetchFileHistory();
  }, []);

  const handleDownloadFile = async (filePath) => {
    window.open(`http://localhost:3000/${filePath}`, "_blank");
  };

  const saveFileToDatabase = async (bulkData) => {
    if (bulkData.length === 0) return;

    const worksheet = XLSX.utils.json_to_sheet(bulkData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Bulk Data Results");

    const excelBuffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
    });
    const blob = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const formData = new FormData();
    formData.append("file", blob, "Bulk_Data_Results.xlsx");
    formData.append("userEmail", userEmail);
    // Pass user email for tracking

    try {
      const response = await fetch("http://localhost:3000/excel/saveFile", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Failed to save file");

      alert("File saved successfully in history!");
    } catch (error) {
      console.error("Error saving file:", error);
      alert("Error saving file to database.");
    }
  };

  const saveLinksToDatabase = async (validLinks) => {
    try {
      const response = await fetch("http://localhost:3000/uploadedLinks/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userEmail, links: validLinks }),
      });
      if (!response.ok) throw new Error("Failed to save links");

      const data = await response.json();
      console.log("Response:", data);
      alert(data.message || "Links saved successfully!");
      // ✅ Call the new API to update uploaded_links from temp_mobile_data
      await updateUploadedLinks();
    } catch (error) {
      console.error("Error saving links:", error);
      alert("Error saving links to database.");
    }
  };

  // ✅ New function to call the update API
  const updateUploadedLinks = async () => {
    try {
      const response = await fetch(
        "http://localhost:3000/uploadedLinks/updateUploadedLinks",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );
      if (!response.ok) throw new Error("Failed to update uploaded links");

      const data = await response.json();
      console.log("Update Response:", data);
      alert(data.message || "Uploaded links updated successfully!");
    } catch (error) {
      console.error("Error updating uploaded links:", error);
      alert("Error updating uploaded links.");
    }
  };

  return (
    <div className="dashboard">
      <Sidebar userEmail={userEmail} />

      <div className="main-content">
        <div className="header">
          <h1 className="profile-lookup">Bulk Lookup</h1>
          <p className="credits-info">Credits: {statistics.remainingCredits}</p>
        </div>

        <div className="explore-section">
          <div className="file-upload-container">
            <label htmlFor="file-input" className="upload-label">
              Choose File
            </label>
            {file && <span className="file-name">{file.name}</span>}
            <input
              type="file"
              id="file-input"
              accept=".csv,.xlsx"
              onChange={(e) => setFile(e.target.files[0])}
            />
            <button className="upload-button" onClick={handleFileUpload}>
              {isLoading ? "Uploading..." : "Upload & Fetch"}
            </button>
            {linkCounts && (
              <div>
                {/* Display the counts here */}
                <p>Total Links in Uploaded File: {totalLinksInFile}</p>
                <p>
                  Available Mobile Numbers for Uploaded Links:{" "}
                  {availableMobileLinksInFile}
                </p>
                <button onClick={handleConfirmProcess}>
                  Confirm & Process
                </button>
              </div>
            )}
            {bulkResults.length > 0 && (
              <button className="download-button" onClick={handleDownloadExcel}>
                Download Excel
              </button>
            )}
          </div>
          <table border="1">
            <thead>
              <tr>
                <th>File Name</th>
                <th>Uploaded At</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {fileHistory.map((file) => (
                <tr key={file._id}>
                  <td>{file.fileName}</td>
                  <td>{new Date(file.uploadedAt).toLocaleString()}</td>
                  <td>
                    <button onClick={() => handleDownloadFile(file.filePath)}>
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default BulkLookup;
